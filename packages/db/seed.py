#!/usr/bin/env python3
"""Seed the Celsius Coffee inventory database from Google Sheets CSVs."""

import csv
import uuid
import os
import psycopg2

DB_URL = os.environ.get("DIRECT_URL") or "postgresql://postgres.akkwdrllvcpnkzgmclkk:PqLHwEiggEqe1iAd@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def uid():
    return str(uuid.uuid4())


def clean(val):
    if val is None:
        return None
    v = val.strip()
    return v if v else None


def parse_phone(raw):
    if not raw:
        return None
    raw = raw.strip().replace(" ", "")
    if raw.startswith("+60"):
        return raw
    if raw.startswith("60"):
        return "+" + raw
    if raw.startswith("0"):
        return "+60" + raw[1:]
    # Assume it's a number without prefix
    if raw.isdigit() and len(raw) > 8:
        return "+60" + raw
    return raw


def parse_uom(raw):
    """Map sheet UOM strings to our base UOM codes."""
    if not raw:
        return "pcs"
    r = raw.strip().upper()
    if "MILLILITER" in r or r.startswith("ML"):
        return "ml"
    if "GRAM" in r or r.startswith("G ") or r == "G":
        return "g"
    if "KILOGRAM" in r or r.startswith("KG"):
        return "g"  # base is grams
    if "LITER" in r or r.startswith("L ") or r == "L":
        return "ml"  # base is ml
    if "BOTTLE" in r or r.startswith("BOTL") or r.startswith("BTL"):
        return "pcs"
    if "CARTON" in r or r.startswith("CTN"):
        return "pcs"
    if "PACK" in r or r.startswith("PKT"):
        return "pcs"
    if "PCS" in r or "PIECE" in r:
        return "pcs"
    if "ROLL" in r:
        return "pcs"
    if "SLEEVE" in r:
        return "pcs"
    if "PAIR" in r:
        return "pcs"
    if "SET" in r:
        return "pcs"
    if "SHEET" in r:
        return "pcs"
    if "BOX" in r:
        return "pcs"
    if "UNIT" in r:
        return "pcs"
    return "pcs"


def parse_pkg_uom(raw):
    """Map packaging UOM to a display name."""
    if not raw:
        return "Unit"
    r = raw.strip()
    parts = r.split("(")
    if len(parts) > 1:
        label = parts[1].rstrip(")")
    else:
        label = parts[0]
    # Clean up
    mapping = {
        "CTN": "Carton", "CARTON": "Carton",
        "BOTL": "Bottle", "BOTTLE": "Bottle", "BTL": "Bottle",
        "KG": "Kilogram", "KILOGRAM": "Kilogram",
        "PKT": "Pack", "PACK": "Pack", "PACKET": "Pack",
        "PCS": "Piece", "PIECE": "Piece",
        "ROLL": "Roll", "BOX": "Box", "BAG": "Bag",
        "SLEEVE": "Sleeve", "TRAY": "Tray",
        "SET": "Set", "PAIR": "Pair",
        "SHEET": "Sheet", "UNIT": "Unit",
        "SACHET": "Sachet", "TUB": "Tub",
        "Botl": "Bottle", "Carton": "Carton",
        "Kilogram": "Kilogram", "Gram": "Gram",
        "Pack": "Pack", "Piece": "Piece",
    }
    for k, v in mapping.items():
        if label.upper().startswith(k.upper()):
            return v
    return label if label else "Unit"


def slugify(name):
    return name.lower().replace(" ", "-").replace("&", "and").replace("/", "-")


def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    print("Connected to database. Starting seed...")

    # ── 1. Branches ──
    print("\n── Seeding Branches ──")
    branches = {}
    branch_data = [
        ("CC001", "Celsius Coffee Putrajaya", "M-G-06 Persiaran IRC3, IOI City Resort, 62502 Putrajaya", "Putrajaya", "Putrajaya", "+60172096058"),
        ("CF IOI Mall", "Celsius Coffee IOI Mall", "M-G-06 Persiaran IRC3, IOI City Resort, 62502 Putrajaya", "Putrajaya", "Putrajaya", "+60172096058"),
        ("CC002", "Celsius Coffee Shah Alam", "58, Jalan Renang 13/26, Tadisma Business Park, 40100 Shah Alam, Selangor", "Shah Alam", "Selangor", "+60172096058"),
        ("CC003", "Celsius Coffee Tamarind", "K-05, Level 3m, Tamarind Square, Persiaran Multimedia, 63000 Cyberjaya, Selangor", "Cyberjaya", "Selangor", "+60172096058"),
        ("CF Nilai", "Celsius Coffee Nilai", "Persiaran Korporat, 71800 Nilai, Negeri Sembilan", "Nilai", "Negeri Sembilan", "+60172096058"),
    ]
    # Short codes for matching
    branch_short = {
        "CCP": "CC001", "CCSA": "CC002", "CCTS": "CC003",
        "CCIOI": "CF IOI Mall", "CCN": "CF Nilai",
        "Celsius Coffee Putrajaya": "CC001",
        "Celsius Coffee IOI Mall": "CF IOI Mall",
        "Celsius Coffee Shah Alam": "CC002",
        "Celsius Coffee Tamarind": "CC003",
        "Celsius Coffee Nilai": "CF Nilai",
    }

    for code, name, address, city, state, phone in branch_data:
        bid = uid()
        branches[code] = bid
        cur.execute(
            '''INSERT INTO "Branch" (id, code, name, type, address, city, state, phone, status, "createdAt", "updatedAt")
               VALUES (%s, %s, %s, 'OUTLET', %s, %s, %s, %s, 'ACTIVE', NOW(), NOW())
               ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address RETURNING id''',
            (bid, code, name, address, city, state, phone)
        )
        row = cur.fetchone()
        if row:
            branches[code] = row[0]
        print(f"  {code}: {name}")
    conn.commit()

    # ── 2. Categories ──
    print("\n── Seeding Categories ──")
    categories = {}
    cat_names = [
        'Bread', 'Cake', 'Cleaning', 'Coffee Bean', 'Cookies', 'Croissant',
        'Dairy', 'Flavour', 'Flour', 'Fresh Fruit', 'Fresh Vegetable', 'Meat',
        'Non-Food Item', 'Oil', 'Packaging', 'Powder', 'Raw Material', 'Sauce',
        'Seasoning', 'Spread', 'Sweetener', 'Topping'
    ]
    for cat_name in cat_names:
        cid = uid()
        slug = slugify(cat_name)
        cur.execute(
            '''INSERT INTO "Category" (id, name, slug)
               VALUES (%s, %s, %s)
               ON CONFLICT (name) DO UPDATE SET slug=EXCLUDED.slug RETURNING id''',
            (cid, cat_name, slug)
        )
        row = cur.fetchone()
        categories[cat_name] = row[0] if row else cid
    conn.commit()
    print(f"  {len(categories)} categories")

    # ── 3. Products + ProductPackages ──
    print("\n── Seeding Products + Packages ──")
    products = {}  # name -> {id, sku_base}
    product_packages = {}  # sku -> package_id

    with open(os.path.join(DATA_DIR, "Products.csv"), "r") as f:
        reader = csv.reader(f)
        rows = list(reader)

    # Data starts after the multi-line header (row index ~23, line 24)
    data_rows = []
    for r in rows:
        if len(r) > 3 and r[3] and r[3].strip() and not r[3].strip().startswith("Product") and not r[3].strip().startswith("Must"):
            data_rows.append(r)

    for r in data_rows:
        name = clean(r[0])
        cat_name = clean(r[1])
        base_uom_raw = clean(r[2])
        sku = clean(r[3])
        # is_menu = clean(r[5])
        pkg_uom_raw = clean(r[6])
        # pkg_unit = clean(r[7])  # always 1
        conversion = clean(r[8])
        description = clean(r[13]) if len(r) > 13 else None
        branch_assign = clean(r[14]) if len(r) > 14 else None

        if not name or not sku:
            continue

        base_uom = parse_uom(base_uom_raw)
        cat_id = categories.get(cat_name) if cat_name else None

        # Determine storage area from category
        storage = "DRY_STORE"
        if cat_name in ("Dairy", "Meat", "Fresh Fruit", "Fresh Vegetable"):
            storage = "FRIDGE"
        elif cat_name in ("Packaging", "Non-Food Item", "Cleaning"):
            storage = "COUNTER"

        # Create product if not exists
        if name not in products:
            pid = uid()
            cur.execute(
                '''INSERT INTO "Product" (id, name, sku, "categoryId", "baseUom", "storageArea", "isActive", "createdAt", "updatedAt")
                   VALUES (%s, %s, %s, %s, %s, %s, true, NOW(), NOW())
                   ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name RETURNING id''',
                (pid, name, sku, cat_id, base_uom, storage)
            )
            row = cur.fetchone()
            pid = row[0] if row else pid
            products[name] = {"id": pid, "base_uom": base_uom, "sku": sku}
        else:
            pid = products[name]["id"]

        # Create package
        conv_factor = 1
        if conversion:
            try:
                conv_factor = float(conversion)
            except ValueError:
                conv_factor = 1

        pkg_name = parse_pkg_uom(pkg_uom_raw)
        pkg_label = f"{pkg_name} ({int(conv_factor)}{base_uom})" if conv_factor > 1 else pkg_name
        is_default = (sku == products[name]["sku"])  # first package is default

        ppid = uid()
        cur.execute(
            '''INSERT INTO "ProductPackage" (id, "productId", "packageName", "packageLabel", "conversionFactor", "isDefault")
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT ("productId", "packageName") DO UPDATE SET "packageLabel"=EXCLUDED."packageLabel", "conversionFactor"=EXCLUDED."conversionFactor" RETURNING id''',
            (ppid, pid, pkg_name, pkg_label, conv_factor, is_default)
        )
        row = cur.fetchone()
        ppid = row[0] if row else ppid
        product_packages[sku] = ppid

        # Assign to branches via BranchProduct
        if branch_assign:
            ba = branch_assign.strip().lower()
            if ba == "all":
                target_branches = list(branches.keys())
            else:
                target_branches = []
                for part in branch_assign.split(","):
                    part = part.strip()
                    if part in branch_short:
                        target_branches.append(branch_short[part])
                    elif part in branches:
                        target_branches.append(part)

            for bcode in target_branches:
                if bcode in branches:
                    cur.execute(
                        '''INSERT INTO "BranchProduct" (id, "branchId", "productId", "isActive", "countFrequency")
                           VALUES (%s, %s, %s, true, 'DAILY')
                           ON CONFLICT DO NOTHING''',
                        (uid(), branches[bcode], pid)
                    )

    conn.commit()
    print(f"  {len(products)} unique products, {len(product_packages)} packages")

    # ── 4. Suppliers ──
    print("\n── Seeding Suppliers ──")
    suppliers = {}  # name -> id

    with open(os.path.join(DATA_DIR, "Suppliers.csv"), "r") as f:
        reader = csv.reader(f)
        rows = list(reader)

    for r in rows:
        if len(r) < 10:
            continue
        name = clean(r[0])
        if not name or name.startswith("SUPPLIER"):
            continue

        phone = parse_phone(clean(r[1]))
        email = clean(r[2])
        supplier_code = clean(r[3]) or slugify(name)[:20]
        location = clean(r[13]) if len(r) > 13 else None  # city
        address = clean(r[10]) if len(r) > 10 else None

        sid = uid()
        # Use name as supplierCode if no code provided (must be unique)
        s_code = supplier_code if supplier_code else name[:30]
        cur.execute(
            '''INSERT INTO "Supplier" (id, name, "supplierCode", phone, email, location, status, "createdAt", "updatedAt")
               VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', NOW(), NOW())
               ON CONFLICT ("supplierCode") DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, email=EXCLUDED.email RETURNING id''',
            (sid, name, s_code, phone, email, location)
        )
        row = cur.fetchone()
        suppliers[name] = row[0] if row else sid

    conn.commit()
    print(f"  {len(suppliers)} suppliers")

    # ── 5. Buy Catalogue → SupplierProduct ──
    print("\n── Seeding SupplierProduct (Buy Catalogue) ──")
    sp_count = 0

    with open(os.path.join(DATA_DIR, "Buy Catalogue (Supplier) .csv"), "r") as f:
        reader = csv.reader(f)
        rows = list(reader)

    for r in rows:
        if len(r) < 7:
            continue
        supplier_name = clean(r[0])
        product_name = clean(r[1])
        # base_uom = clean(r[2])  # automatic
        pkg_uom = clean(r[3])
        # pkg_unit = clean(r[4])
        conversion = clean(r[5])
        price_str = clean(r[6])

        if not supplier_name or not product_name or supplier_name.startswith("SUPPLIER"):
            continue

        supplier_id = suppliers.get(supplier_name)
        if not supplier_id:
            # Try partial match
            for sname, sid in suppliers.items():
                if supplier_name.lower() in sname.lower() or sname.lower() in supplier_name.lower():
                    supplier_id = sid
                    break
        product_info = products.get(product_name)
        if not supplier_id:
            print(f"  WARN: Supplier not found: '{supplier_name}'")
            continue
        if not product_info:
            # Try fuzzy match
            for pname, pinfo in products.items():
                if product_name.lower() in pname.lower() or pname.lower() in product_name.lower():
                    product_info = pinfo
                    break
            if not product_info:
                continue

        price = 0
        if price_str:
            try:
                price = float(price_str.replace(",", ""))
            except ValueError:
                price = 0

        # Find the matching package
        pkg_id = None
        conv_factor = 1
        if conversion:
            try:
                conv_factor = float(conversion)
            except ValueError:
                conv_factor = 1

        # Look for a matching package by conversion factor
        cur.execute(
            '''SELECT id FROM "ProductPackage" WHERE "productId" = %s AND "conversionFactor" = %s LIMIT 1''',
            (product_info["id"], conv_factor)
        )
        row = cur.fetchone()
        if row:
            pkg_id = row[0]
        else:
            # Get default package
            cur.execute(
                '''SELECT id FROM "ProductPackage" WHERE "productId" = %s AND "isDefault" = true LIMIT 1''',
                (product_info["id"],)
            )
            row = cur.fetchone()
            pkg_id = row[0] if row else None

        if not pkg_id:
            continue

        cur.execute(
            '''INSERT INTO "SupplierProduct" (id, "supplierId", "productId", "productPackageId", price, "isActive", "updatedAt")
               VALUES (%s, %s, %s, %s, %s, true, NOW())
               ON CONFLICT ("supplierId", "productId", "productPackageId") DO UPDATE SET price=EXCLUDED.price, "updatedAt"=NOW() RETURNING id''',
            (uid(), supplier_id, product_info["id"], pkg_id, price)
        )
        sp_count += 1

    conn.commit()
    print(f"  {sp_count} supplier-product links")

    # ── 6. Menu Items + BOM (from Online Orders CSV) ──
    print("\n── Seeding Menu Items + BOM ──")
    menu_count = 0
    bom_count = 0

    # Extract menu items from Online Orders
    orders_csv = "/Users/ammarshahrin/Downloads/Online_Orders_02-09-2026_03-10-2026.csv"
    menu_items_raw = {}
    if os.path.exists(orders_csv):
        with open(orders_csv, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get("Item", "").strip()
                pid = row.get("Product ID", "").strip()
                subtotal = row.get("Subtotal", "0").strip()
                if name and pid and name not in menu_items_raw:
                    try:
                        price = float(subtotal) if subtotal else 0
                    except ValueError:
                        price = 0
                    menu_items_raw[name] = {"storehubId": pid, "price": price}

    # Categorize menus
    coffee_keywords = ["Latte", "Mocha", "Cappucino", "Black", "Macchiato", "Freddo", "Cold Brew"]
    food_keywords = ["Nasi", "Pasta", "Aglio", "Bolognese", "Carbonara", "Fries", "Sando", "Croissant", "Brioche", "Chicken", "Bihun"]
    dessert_keywords = ["Cake", "Choc", "Pavlova", "Smores", "Mont Blanc", "Mudslide", "Batik"]

    def categorize_menu(name):
        for kw in food_keywords:
            if kw.lower() in name.lower():
                return "Food"
        for kw in dessert_keywords:
            if kw.lower() in name.lower():
                return "Dessert"
        for kw in coffee_keywords:
            if kw.lower() in name.lower():
                return "Coffee"
        if "tea" in name.lower() or "mojito" in name.lower() or "peppermint" in name.lower():
            return "Non-Coffee"
        if "matcha" in name.lower() or "chocolate" in name.lower() or "berry" in name.lower() or "strawberry" in name.lower():
            return "Non-Coffee"
        return "Coffee"

    # BOM recipes: menu_name -> [(product_name, qty_per_serve, uom)]
    bom_recipes = {
        # Coffee drinks (base: espresso 18g + milk 200ml for latte-based)
        "Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml")],
        "Spanish Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 150, "ml"), ("Condensed milk", 30, "ml")],
        "Cappucino": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 180, "ml")],
        "Black": [("Home Blend (Collective)", 18, "g")],
        "Mocha": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 180, "ml"), ("Chocolate Powder", 15, "g")],
        "Caramel Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml"), ("Monin Caramel Syrup", 20, "ml")],
        "Caramel Macchiato": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml"), ("Monin Caramel Sauce", 15, "ml")],
        "Salted Caramel Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml"), ("Monin Salted Caramel Syrup", 20, "ml")],
        "Hazelnut Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml"), ("Monin Hazelnut Syrup", 20, "ml")],
        "Vanilla Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml"), ("Monin Vanilla Syrup", 20, "ml")],
        "White Mocha": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 180, "ml"), ("DVG White Chocolate Flavored Sauce", 20, "ml")],
        "Peanut Butter Mocha": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 180, "ml"), ("Chocolate Powder", 10, "g"), ("Peanut Butter", 15, "g")],
        "Mint Chocolate": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 180, "ml"), ("Mint Chocolate powder", 15, "g")],
        "Buttercream Latte": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 200, "ml"), ("DVG Butterscotch Sauce", 20, "ml")],
        "Buttercream Chocolate": [("Home Blend (Collective)", 18, "g"), ("Fresh Milk", 180, "ml"), ("DVG Butterscotch Sauce", 15, "ml"), ("Chocolate Powder", 10, "g")],
        # Non-coffee
        "Matcha": [("Matcha Powder", 5, "g"), ("Fresh Milk", 200, "ml")],
        "Matcha Cream Latte": [("Matcha Powder", 5, "g"), ("Fresh Milk", 200, "ml"), ("Emborg Whipping Cream", 30, "ml")],
        "Matcha Batik Indulgence": [("Matcha Powder", 5, "g"), ("Fresh Milk", 200, "ml"), ("DVG Chocolate Flavored Sauce", 15, "ml")],
        "Strawberry Matcha": [("Matcha Powder", 5, "g"), ("Fresh Milk", 200, "ml"), ("DVG Strawberry Sauce", 20, "ml")],
        "Chocolate": [("Chocolate Powder", 25, "g"), ("Fresh Milk", 200, "ml")],
        "Chocolate Freddo": [("Chocolate Powder", 25, "g"), ("Fresh Milk", 200, "ml")],
        "Berry Berries": [("DVG Super Berries Syrup", 30, "ml"), ("Fresh Milk", 200, "ml")],
        "Peppermint": [("DVG Classic Pepper Mint", 25, "ml"), ("Fresh Milk", 200, "ml")],
        "Citrus Iced Lemon Tea": [("Monin Lemon Tea Syrup", 30, "ml"), ("Lemon", 30, "g")],
        "Citrus Mojito": [("Lime", 30, "g"), ("Mint Leaves", 3, "g"), ("Gula", 15, "g")],
        "Pomegranate Iced Tea": [("Monin Lemon Tea Syrup", 25, "ml")],
        "Chocolate Mudslide": [("Chocolate Powder", 20, "g"), ("Fresh Milk", 180, "ml"), ("DVG Chocolate Flavored Sauce", 20, "ml")],
        # Food
        "Nasi Lemak 2 Sambal + Ayam Crispy": [("Beras", 200, "g"), ("Santan Kara", 50, "ml"), ("Telur", 1, "pcs"), ("Timun Jepun", 30, "g"), ("Garam", 2, "g")],
        "Nasi Lemak 2 Sambal + Ayam Grilled": [("Beras", 200, "g"), ("Santan Kara", 50, "ml"), ("Telur", 1, "pcs"), ("Timun Jepun", 30, "g"), ("Garam", 2, "g")],
        "Bihun Kari Asam": [("Chicken Stock", 5, "g"), ("Serbuk Kari", 10, "g"), ("Asam Jawa", 5, "g"), ("Taugeh", 30, "g")],
        "Beef Bolognese": [("Spaghetti", 120, "g"), ("Streaky Beef", 80, "g"), ("Tomato Puree", 30, "g"), ("Peeled Garlic", 5, "g"), ("Olive Oil", 10, "ml")],
        "Crispy Prawn Creamy Carbonara": [("Spaghetti", 120, "g"), ("Udang", 60, "g"), ("Emborg Cooking Cream", 50, "ml"), ("Block parmesan", 10, "g"), ("Telur", 1, "pcs")],
        "Smoked Duck Aglio Olio": [("Spaghetti", 120, "g"), ("Olive Oil", 15, "ml"), ("Peeled Garlic", 10, "g"), ("Chili Flake", 2, "g")],
        "Samyang Pasta": [("Spaghetti", 120, "g"), ("Samyang Buldak Sauce", 30, "ml"), ("Shredded Mozarella", 20, "g")],
        "Korean Crispy Chicken": [("Chicken Chop", 150, "g"), ("Tepung Bestari", 30, "g"), ("Kicap Mahsuri Ala Korea", 20, "ml"), ("Cooking Oil", 50, "ml")],
        "Classic Fries": [("French Fries", 150, "g"), ("Cooking Oil", 50, "ml"), ("Garam", 2, "g")],
        "Truffle Fries": [("French Fries", 150, "g"), ("Cooking Oil", 50, "ml"), ("White Truffle Oil", 5, "ml"), ("Floridia Parmesan", 5, "g")],
        "Korean Spicy Fries": [("French Fries", 150, "g"), ("Cooking Oil", 50, "ml"), ("Samyang Buldak Sauce", 15, "ml")],
        "Loaded Fries": [("French Fries", 180, "g"), ("Cooking Oil", 50, "ml"), ("Shredded Mozarella", 30, "g"), ("DVG Caramel Sauce", 10, "ml")],
        "Egg Sando": [("Brioche Sandwich", 1, "pcs"), ("Telur", 2, "pcs"), ("Kewpie Spread", 10, "g")],
        "Roti Bakar Brioche": [("Brioche Roti Bakar", 1, "pcs"), ("Sri Kaya", 15, "g"), ("Anchor Salt Butter", 10, "g")],
        "Salted Egg Croissant": [("Salted Croissant", 1, "pcs")],
        # Desserts
        "Mini Double Choc (3 pcs)": [("NYC Double Chocolate", 3, "pcs")],
        "Mini Hazelnut Seasalt (3 pcs)": [("NYC Hazelnut Sea Salt", 3, "pcs")],
        "NYC Smores": [("NYC Smores", 1, "pcs")],
        "Mini Pavlova": [("Pavlova", 1, "pcs")],
        "Mont Blanc": [("Classic Croissant", 1, "pcs"), ("Emborg Whipping Cream", 30, "ml")],
    }

    menus = {}  # name -> id
    for menu_name, info in menu_items_raw.items():
        cat = categorize_menu(menu_name)
        mid = uid()
        cur.execute(
            '''INSERT INTO "Menu" (id, name, category, "sellingPrice", "storehubId", "isActive", "lastSyncedAt", "createdAt", "updatedAt")
               VALUES (%s, %s, %s, %s, %s, true, NOW(), NOW(), NOW())
               ON CONFLICT ("storehubId") DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, "sellingPrice"=EXCLUDED."sellingPrice" RETURNING id''',
            (mid, menu_name, cat, info["price"], info["storehubId"])
        )
        row = cur.fetchone()
        menus[menu_name] = row[0] if row else mid
        menu_count += 1

    conn.commit()
    print(f"  {menu_count} menu items")

    # Seed BOM (MenuIngredient)
    for menu_name, recipe in bom_recipes.items():
        menu_id = menus.get(menu_name)
        if not menu_id:
            continue
        for product_name, qty, uom in recipe:
            product_info = products.get(product_name)
            if not product_info:
                # Try partial match
                for pname, pinfo in products.items():
                    if product_name.lower() in pname.lower() or pname.lower() in product_name.lower():
                        product_info = pinfo
                        break
            if not product_info:
                print(f"  WARN BOM: Product not found: '{product_name}' for menu '{menu_name}'")
                continue
            cur.execute(
                '''INSERT INTO "MenuIngredient" (id, "menuId", "productId", "quantityUsed", uom)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT ("menuId", "productId") DO UPDATE SET "quantityUsed"=EXCLUDED."quantityUsed", uom=EXCLUDED.uom''',
                (uid(), menu_id, product_info["id"], qty, uom)
            )
            bom_count += 1

    conn.commit()
    print(f"  {bom_count} BOM ingredient links")

    # ── 7. Admin User ──
    print("\n── Seeding Admin User ──")
    admin_id = uid()
    cur.execute(
        '''INSERT INTO "User" (id, name, email, phone, role, "branchId", status, "createdAt", "updatedAt")
           VALUES (%s, 'Ammar Shahrin', 'ammar@celsiuscoffee.com', '+60172096058', 'ADMIN', %s, 'ACTIVE', NOW(), NOW())
           ON CONFLICT (email) DO NOTHING''',
        (admin_id, branches.get("CC001"))
    )
    conn.commit()
    print("  Admin: Ammar Shahrin")

    # ── Summary ──
    print("\n" + "=" * 50)
    print("SEED COMPLETE!")
    print(f"  Branches:         {len(branches)}")
    print(f"  Categories:       {len(categories)}")
    print(f"  Products:         {len(products)}")
    print(f"  Product Packages: {len(product_packages)}")
    print(f"  Suppliers:        {len(suppliers)}")
    print(f"  Supplier-Product: {sp_count}")
    print(f"  Menu Items:       {menu_count}")
    print(f"  BOM Ingredients:  {bom_count}")
    print("=" * 50)

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()

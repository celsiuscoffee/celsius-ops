-- Categories
create table categories (
  id       text primary key,
  name     text not null,
  slug     text not null,
  position integer not null default 0
);

-- Products (base_price in sen; variants & modifier add-on prices in RM inside JSONB)
create table products (
  id           text primary key,
  category_id  text not null references categories(id),
  name         text not null,
  description  text not null default '',
  base_price   integer not null,   -- in sen (RM * 100)
  image        text not null default '',
  is_available boolean not null default true,
  is_popular   boolean not null default false,
  is_new       boolean not null default false,
  variants     jsonb not null default '[]',   -- [{id,name,price}] price in RM
  modifiers    jsonb not null default '{}',   -- {iceLevel:[],sugarLevel:[],addOns:[{name,price}]}
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_products_category on products(category_id);
create index idx_products_position on products(position);

alter table categories enable row level security;
alter table products    enable row level security;

create policy "public read categories" on categories for select using (true);
create policy "public read products"   on products   for select using (true);

create trigger products_updated_at
  before update on products
  for each row execute function update_updated_at();

-- Seed categories
insert into categories (id, name, slug, position) values
  ('signature',  'Signature',  'signature',  1),
  ('espresso',   'Espresso',   'espresso',   2),
  ('non-coffee', 'Non-Coffee', 'non-coffee', 3),
  ('pastries',   'Pastries',   'pastries',   4),
  ('add-ons',    'Add-ons',    'add-ons',    5);

-- Seed products
insert into products (id, category_id, name, description, base_price, image, is_popular, is_new, variants, modifiers, position) values
(
  'celsius-latte', 'signature', 'Celsius Latte',
  'Our signature latte with perfectly steamed milk and a double shot of espresso.',
  1100,
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=400&fit=crop&q=80',
  true, false,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal","Less Ice","No Ice"],"sugarLevel":["100%","75%","50%","25%","0%"],"addOns":[{"name":"Extra Shot","price":2},{"name":"Oat Milk","price":2},{"name":"Whipped Cream","price":1.5},{"name":"Caramel Drizzle","price":1.5}]}',
  1
),
(
  'brown-sugar-boba', 'signature', 'Brown Sugar Boba Latte',
  'Rich brown sugar syrup with chewy boba pearls, espresso, and fresh milk.',
  1300,
  'https://images.unsplash.com/photo-1551030173-122aafebd7a6?w=400&h=400&fit=crop&q=80',
  true, true,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal","Less Ice","No Ice"],"sugarLevel":["100%","75%","50%","25%","0%"],"addOns":[{"name":"Extra Shot","price":2},{"name":"Oat Milk","price":2},{"name":"Whipped Cream","price":1.5},{"name":"Caramel Drizzle","price":1.5}]}',
  2
),
(
  'spanish-latte', 'signature', 'Spanish Latte',
  'Sweetened condensed milk blended with our espresso for a creamy, indulgent treat.',
  1200,
  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&h=400&fit=crop&q=80',
  false, false,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal","Less Ice","No Ice"],"sugarLevel":["100%","75%","50%","25%","0%"],"addOns":[{"name":"Extra Shot","price":2},{"name":"Oat Milk","price":2},{"name":"Whipped Cream","price":1.5},{"name":"Caramel Drizzle","price":1.5}]}',
  3
),
(
  'matcha-latte', 'signature', 'Matcha Latte',
  'Premium Japanese matcha whisked with steamed milk for a smooth, earthy flavour.',
  1200,
  'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=400&h=400&fit=crop&q=80',
  false, true,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal","Less Ice","No Ice"],"sugarLevel":["100%","75%","50%","25%","0%"],"addOns":[{"name":"Oat Milk","price":2},{"name":"Whipped Cream","price":1.5},{"name":"Extra Matcha","price":2}]}',
  4
),
(
  'americano', 'espresso', 'Americano',
  'Double shot espresso with hot or cold water. Simple and bold.',
  800,
  'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=400&h=400&fit=crop&q=80',
  true, false,
  '[{"id":"small","name":"S","price":8},{"id":"medium","name":"M","price":9},{"id":"large","name":"L","price":10}]',
  '{"iceLevel":["Normal","Less Ice","No Ice","Hot"],"sugarLevel":["0%","25%","50%"],"addOns":[{"name":"Extra Shot","price":2}]}',
  5
),
(
  'cappuccino', 'espresso', 'Cappuccino',
  'Classic cappuccino with equal parts espresso, steamed milk, and foam.',
  1000,
  'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop&q=80',
  false, false,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal","Less Ice","No Ice"],"sugarLevel":["100%","75%","50%","25%","0%"],"addOns":[{"name":"Extra Shot","price":2},{"name":"Oat Milk","price":2},{"name":"Whipped Cream","price":1.5},{"name":"Caramel Drizzle","price":1.5}]}',
  6
),
(
  'flat-white', 'espresso', 'Flat White',
  'Velvety microfoam poured over a double ristretto shot.',
  1100,
  'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop&q=80',
  false, false,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal","Less Ice","No Ice"],"sugarLevel":["100%","75%","50%","25%","0%"],"addOns":[{"name":"Extra Shot","price":2},{"name":"Oat Milk","price":2},{"name":"Whipped Cream","price":1.5},{"name":"Caramel Drizzle","price":1.5}]}',
  7
),
(
  'chocolate-frappe', 'non-coffee', 'Chocolate Frappe',
  'Rich chocolate blended with ice and topped with whipped cream.',
  1300,
  'https://images.unsplash.com/photo-1572490122747-3e9197aa5b1e?w=400&h=400&fit=crop&q=80',
  false, false,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal"],"sugarLevel":["100%","75%","50%"],"addOns":[{"name":"Whipped Cream","price":1.5},{"name":"Chocolate Drizzle","price":1.5}]}',
  8
),
(
  'mango-smoothie', 'non-coffee', 'Mango Smoothie',
  'Fresh mango blended with yogurt and ice for a tropical treat.',
  1200,
  'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=400&h=400&fit=crop&q=80',
  false, false,
  '[{"id":"small","name":"S","price":9},{"id":"medium","name":"M","price":11},{"id":"large","name":"L","price":13}]',
  '{"iceLevel":["Normal"],"sugarLevel":["100%","75%","50%"],"addOns":[]}',
  9
),
(
  'butter-croissant', 'pastries', 'Butter Croissant',
  'Flaky, golden butter croissant baked fresh daily.',
  600,
  'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&h=400&fit=crop&q=80',
  false, false,
  '[]',
  '{"iceLevel":[],"sugarLevel":[],"addOns":[]}',
  10
),
(
  'chocolate-muffin', 'pastries', 'Chocolate Muffin',
  'Moist chocolate muffin with chocolate chips.',
  700,
  'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&h=400&fit=crop&q=80',
  true, false,
  '[]',
  '{"iceLevel":[],"sugarLevel":[],"addOns":[]}',
  11
);

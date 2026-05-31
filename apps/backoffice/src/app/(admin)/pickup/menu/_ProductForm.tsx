"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, X, ImagePlus, ZoomIn } from "lucide-react";
import { toast } from "@celsius/ui";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { ModifierGroupsEditor, type ModifierGroup } from "./_ModifierGroupsEditor";

export interface DbProduct {
  id: string;
  category_id: string;
  name: string;
  description: string;
  base_price: number;
  image: string;
  image_zoom: number;
  is_available: boolean;
  is_popular: boolean;
  is_new: boolean;
  variants: { id: string; name: string; price: number }[];
  modifiers: ModifierGroup[];
  hidden_modifier_ids: string[];
  position: number;
  featured_position: number;
  print_additional_docket: boolean;
  // Kitchen station routing — drives the per-station docket split on the
  // SUNMI POS-native printer. Null/empty = no kitchen docket printed.
  kitchen_station: string | null;
  e_invoice_classification_code: string;
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  schedule_days_of_week: number[];
  schedule_time_from: string | null;
  schedule_time_to: string | null;
  price_pickup: number | null;
  price_grab: number | null;
  price_foodpanda: number | null;
  price_dinein: number | null;
  tax_rate: number;
  tax_inclusive: boolean;
}

export interface Category { id: string; name: string; slug: string; position?: number }

function emptyForm(categories: Category[]) {
  return {
    id:            "",
    category_id:   categories[0]?.id ?? "",
    name:          "",
    description:   "",
    base_price_rm: 10,
    image:         "",
    image_zoom:    100,
    is_available:  true,
    is_popular:    false,
    is_new:        false,
    print_additional_docket:        false,
    kitchen_station:                "" as string,
    e_invoice_classification_code:  "",
    schedule_start_date:            "" as string,
    schedule_end_date:              "" as string,
    schedule_days_of_week:          [] as number[],
    schedule_time_from:             "" as string,
    schedule_time_to:               "" as string,
    price_pickup:                   "" as string | number,
    price_grab:                     "" as string | number,
    price_foodpanda:                "" as string | number,
    price_dinein:                   "" as string | number,
    tax_rate:                       0,
    tax_inclusive:                  true,
    modifiers:                      [] as ModifierGroup[],
  };
}

interface Props {
  product: DbProduct | null;  // null = create new
  categories: Category[];
}

export function ProductForm({ product, categories }: Props) {
  const router = useRouter();
  const isEditing = !!product;

  const [form, setForm] = useState(() => {
    if (!product) return emptyForm(categories);
    const zoom = product.image_zoom ?? 100;
    return {
      id:            product.id,
      category_id:   product.category_id,
      name:          product.name,
      description:   product.description,
      base_price_rm: product.base_price / 100,
      image:         product.image,
      image_zoom:    zoom,
      is_available:  product.is_available,
      is_popular:    product.is_popular,
      is_new:        product.is_new,
      print_additional_docket:        product.print_additional_docket ?? false,
      kitchen_station:                product.kitchen_station ?? "",
      e_invoice_classification_code:  product.e_invoice_classification_code ?? "",
      schedule_start_date:            product.schedule_start_date ?? "",
      schedule_end_date:              product.schedule_end_date ?? "",
      schedule_days_of_week:          product.schedule_days_of_week ?? [],
      schedule_time_from:             (product.schedule_time_from ?? "").slice(0, 5),
      schedule_time_to:               (product.schedule_time_to ?? "").slice(0, 5),
      price_pickup:                   product.price_pickup ?? "",
      price_grab:                     product.price_grab ?? "",
      price_foodpanda:                product.price_foodpanda ?? "",
      price_dinein:                   product.price_dinein ?? "",
      tax_rate:                       product.tax_rate ?? 0,
      tax_inclusive:                  product.tax_inclusive ?? true,
      modifiers:                      product.modifiers ?? [],
    };
  });

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(form.image_zoom);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("productId", form.name.replace(/\s+/g, "-").toLowerCase() || "product");

      const res  = await fetch("/api/pickup/upload-image", { method: "POST", body: fd });
      const json = await res.json() as { url?: string; error?: string };

      if (json.url) setForm((f) => ({ ...f, image: json.url! }));
      else toast.error(json.error ?? "Upload failed");
    } catch (e) {
      toast.error("Upload failed: " + String(e));
    }
    setUploading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const channelPrice = (v: string | number) =>
      v === "" || v === null || typeof v === "undefined"
        ? null
        : (typeof v === "number" ? v : Number(v));

    const body = {
      ...form,
      base_price_rm: form.base_price_rm,
      price_pickup:    channelPrice(form.price_pickup),
      price_grab:      channelPrice(form.price_grab),
      price_foodpanda: channelPrice(form.price_foodpanda),
      price_dinein:    channelPrice(form.price_dinein),
      tax_rate:        Number(form.tax_rate) || 0,
      modifiers:       form.modifiers,
    };

    try {
      if (isEditing && product) {
        const res = await adminFetch(`/api/pickup/products/${product.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Save failed");
        toast.success("Product saved");
      } else {
        const res = await adminFetch("/api/pickup/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Create failed");
        toast.success("Product created");
      }
      router.push("/pickup/menu");
      router.refresh();
    } catch (err) {
      toast.error(String(err));
      setSaving(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/pickup/menu"
          className="flex items-center justify-center w-9 h-9 rounded-xl border hover:bg-muted/40 transition-colors"
          title="Back to products"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#160800]">
            {isEditing ? "Edit Product" : "Add Product"}
          </h1>
          {isEditing && (
            <p className="text-xs text-muted-foreground mt-0.5">{product?.id}</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 sm:p-6 space-y-5">
        {/* Name */}
        <Field label="Name" required>
          <input
            required
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Celsius Latte"
          />
        </Field>

        {/* Category */}
        <Field label="Category">
          <select
            value={form.category_id}
            onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        {/* Description */}
        <Field label="Description">
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            placeholder="Short description..."
          />
        </Field>

        {/* Base price */}
        <Field label="Base Price (RM)">
          <input
            type="number"
            min={0}
            step={0.01}
            required
            value={form.base_price_rm}
            onChange={(e) => setForm((f) => ({ ...f, base_price_rm: Number(e.target.value) }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        {/* Channel pricing */}
        <div className="border rounded-2xl p-4 bg-muted/10 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Channel pricing</p>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Override the price per sales channel. Leave blank to charge the Base Price above. Used for marketplace markup (Grab/Foodpanda commissions) or dine-in surcharges.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {([
              ["price_pickup",    "Pickup (RM)"],
              ["price_grab",      "GrabFood (RM)"],
              ["price_foodpanda", "Foodpanda (RM)"],
              ["price_dinein",    "Dine-in (RM)"],
            ] as const).map(([fieldKey, label]) => (
              <Field key={fieldKey} label={label}>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form[fieldKey] as number | string}
                  onChange={(e) => setForm((f) => ({ ...f, [fieldKey]: e.target.value === "" ? "" : Number(e.target.value) }))}
                  placeholder="Use base price"
                  className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </Field>
            ))}
          </div>
        </div>

        {/* Image */}
        <Field label="Product Image">
          <div
            className={`flex gap-4 items-start rounded-xl transition-colors ${isDragging ? "bg-primary/10 ring-2 ring-primary/40 p-2" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file && file.type.startsWith("image/")) { handleImageUpload(file); setPreviewZoom(100); }
            }}
          >
            <div className="shrink-0">
              <div className="relative w-28 h-28 rounded-xl border border-border overflow-hidden bg-muted/30">
                {form.image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.image}
                      alt="preview"
                      className="w-full h-full object-contain transition-transform duration-150"
                      style={{ transform: `scale(${previewZoom / 100})`, transformOrigin: "center" }}
                    />
                    <button
                      type="button"
                      onClick={() => { setForm((f) => ({ ...f, image: "" })); setPreviewZoom(100); }}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center transition-colors"
                      title="Remove image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomedImage(form.image)}
                      className="absolute bottom-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full w-5 h-5 flex items-center justify-center transition-colors"
                      title="View full size"
                    >
                      <ZoomIn className="h-2.5 w-2.5" />
                    </button>
                  </>
                ) : uploading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImagePlus className="h-7 w-7" />
                    <span className="text-[10px]">No image</span>
                  </div>
                )}
              </div>
              {form.image && (
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={previewZoom}
                  onChange={(e) => { const v = Number(e.target.value); setPreviewZoom(v); setForm((f) => ({ ...f, image_zoom: v })); }}
                  className="w-28 mt-1.5 accent-[#160800]"
                  title={`Zoom: ${previewZoom}%`}
                />
              )}
            </div>

            <div className="flex-1 space-y-2 pt-0.5">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 border border-border rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? "Uploading..." : isDragging ? "Drop to upload" : "Select or drag image"}
              </button>
              <input
                type="url"
                value={form.image}
                onChange={(e) => { setForm((f) => ({ ...f, image: e.target.value })); setPreviewZoom(100); }}
                className="w-full border rounded-xl px-3 py-2 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="or paste image URL..."
              />
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImageUpload(f); setPreviewZoom(100); } e.target.value = ""; }}
          />
        </Field>

        {/* Badges */}
        <div className="grid grid-cols-3 gap-3">
          {([
            ["is_available", "Available"],
            ["is_popular",   "Popular"],
            ["is_new",       "New"],
          ] as const).map(([fieldKey, label]) => (
            <label key={fieldKey} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form[fieldKey]}
                onChange={(e) => setForm((f) => ({ ...f, [fieldKey]: e.target.checked }))}
                className="h-4 w-4 accent-[#160800]"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        {/* Kitchen Station — drives the per-station docket routing on
            the SUNMI POS. "Print Kitchen docket" is the master toggle:
            ON requires a station, OFF stores NULL kitchen_station which
            means no station-routed docket prints (the item still appears
            on the combined receipt). */}
        <div className="border rounded-2xl p-4 bg-muted/10 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Kitchen Station</p>

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={!!form.kitchen_station}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  // Default to "Kitchen" when first ticked; preserve any
                  // existing station value when re-ticking.
                  kitchen_station: e.target.checked ? (f.kitchen_station || "Kitchen") : "",
                }))
              }
              className="h-4 w-4 accent-[#160800]"
            />
            <span className="font-medium">Print Kitchen docket</span>
          </label>

          {!!form.kitchen_station && (
            <Field label="Station">
              <select
                value={form.kitchen_station ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, kitchen_station: e.target.value }))}
                className="w-full px-3 py-2 border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="Kitchen">Kitchen</option>
                <option value="Bar">Bar</option>
                <option value="Counter">Counter</option>
                <option value="Pastry">Pastry</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Items routed to the same station print together on one docket. Match the printer name in BackOffice → Settings → Printers.
              </p>
            </Field>
          )}
        </div>

        <Field label="e-Invoice classification code (LHDN)">
          <input
            type="text"
            value={form.e_invoice_classification_code}
            onChange={(e) => setForm((f) => ({ ...f, e_invoice_classification_code: e.target.value }))}
            placeholder="e.g. 022"
            className="w-full px-3 py-2 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            MSIC classification code for LHDN e-Invoice compliance. Look up at{" "}
            <a href="https://sdk.myinvois.hasil.gov.my/codes/classification-codes/" target="_blank" rel="noopener" className="text-indigo-600 hover:underline">myinvois.hasil.gov.my</a>.
          </p>
        </Field>

        {/* Tax */}
        <div className="border rounded-2xl p-4 bg-muted/10 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tax &amp; e-Invoice</p>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Per-product SST + LHDN classification override. Leave at defaults to inherit the outlet-level settings.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax Rate (%)">
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={form.tax_rate}
                onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value === "" ? 0 : Number(e.target.value) }))}
                placeholder="0"
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
            <Field label="Tax Inclusive">
              <label className="flex items-center gap-2 cursor-pointer text-sm h-10 px-3 border rounded-xl bg-white">
                <input
                  type="checkbox"
                  checked={form.tax_inclusive}
                  onChange={(e) => setForm((f) => ({ ...f, tax_inclusive: e.target.checked }))}
                  className="h-4 w-4 accent-[#160800]"
                />
                <span className="text-muted-foreground">
                  {form.tax_inclusive ? "Tax is in the price" : "Tax added on top"}
                </span>
              </label>
            </Field>
          </div>
        </div>

        {/* Online schedule */}
        <div className="border rounded-2xl p-4 bg-muted/10 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Online schedule</p>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Limits when this product appears on the customer-facing menu (pickup, web, Grab). POS register ignores schedule — cashiers can always sell anything.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                value={form.schedule_start_date ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, schedule_start_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={form.schedule_end_date ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, schedule_end_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
          </div>

          <Field label="Days of week (empty = every day)">
            <div className="flex flex-wrap gap-1.5">
              {[
                { d: 1, label: "Mon" },
                { d: 2, label: "Tue" },
                { d: 3, label: "Wed" },
                { d: 4, label: "Thu" },
                { d: 5, label: "Fri" },
                { d: 6, label: "Sat" },
                { d: 0, label: "Sun" },
              ].map(({ d, label }) => {
                const on = form.schedule_days_of_week.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      schedule_days_of_week: on
                        ? f.schedule_days_of_week.filter((x) => x !== d)
                        : [...f.schedule_days_of_week, d].sort(),
                    }))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      on
                        ? "bg-[#160800] text-white border-[#160800]"
                        : "bg-white text-muted-foreground border-gray-200 hover:border-[#160800]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="From time">
              <input
                type="time"
                value={form.schedule_time_from ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, schedule_time_from: e.target.value }))}
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
            <Field label="To time">
              <input
                type="time"
                value={form.schedule_time_to ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, schedule_time_to: e.target.value }))}
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
          </div>
        </div>

        {/* Modifier groups — backoffice-owned. Shape mirrors StoreHub:
            group { name, multiSelect, options [{ label, priceDelta, isDefault }] }. */}
        <div className="border rounded-2xl p-4 bg-muted/10 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Modifier groups</p>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Customisation options offered to customers (Milk, Sweetness, Add-ons, etc.). Multi-select lets the customer pick more than one option in the same group.
          </p>
          <ModifierGroupsEditor
            value={form.modifiers}
            onChange={(modifiers) => setForm((f) => ({ ...f, modifiers }))}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t">
          <Link
            href="/pickup/menu"
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-[#160800] transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-[#160800] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isEditing ? "Save Changes" : "Create Product"}
          </button>
        </div>
      </form>

      {/* Image zoom */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setZoomedImage(null)}
        >
          <button
            onClick={() => setZoomedImage(null)}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedImage}
            alt="Product zoom"
            className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

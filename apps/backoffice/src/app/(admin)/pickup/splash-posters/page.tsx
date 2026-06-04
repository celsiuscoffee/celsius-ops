"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  ImagePlus,
  Power,
  Clock,
  Crop,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Copy,
} from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { useConfirm, toast } from "@celsius/ui";
import { PosterCropDialog } from "@/components/pickup/PosterCropDialog";
import { PosterComposer, type ComposerState } from "@/components/pickup/PosterComposer";

type Placement = "splash" | "home" | "pos-display";

type Poster = {
  id: string;
  brand_id: string;
  image_url: string;
  title: string | null;
  deeplink: string | null;
  duration_ms: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
  placement: Placement;
  // Editable composition state — present when the poster was created
  // via AI compose. Null for plain manual uploads.
  composer_state: ComposerState | null;
  // The clean pre-flatten bg URL from the operator's last Re-crop. Set
  // by manual upload, never touched by AI compose save. Acts as a
  // canonical anchor so AI compose can reopen on a clean image even
  // when composer_state is missing (legacy posters, designer uploads).
  original_bg_url: string | null;
  // Day-part round for pos-display posters (breakfast..supper). NULL = always.
  round: string | null;
};

type Form = {
  id: string;
  imageUrl: string;
  title: string;
  deeplink: string;
  durationMs: number;
  active: boolean;
  startsAt: string;
  endsAt: string;
  placement: Placement;
  // Tracks the layer state alongside the rasterised image so saving
  // the form persists both. Reset when the operator manually uploads
  // a new image (which discards the prior composition).
  composerState: ComposerState | null;
  // Mirrors poster.original_bg_url — overwritten by Re-crop uploads,
  // preserved across AI compose saves.
  originalBgUrl: string | null;
  // Day-part round (pos-display only). "" = always.
  round: string;
};

// Cache-bust IMG URLs against the poster's updated_at. Browsers
// otherwise hold the prior bytes after a re-upload (especially for
// posters still on the legacy products/misc.jpg path that Cloudinary
// can serve inconsistently across edges).
function bust(url: string, key: string | number | null | undefined): string {
  if (!url) return url;
  const k = key ?? Date.now();
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}b=${encodeURIComponent(String(k))}`;
}

// Per-placement aspect templates. The crop window in the upload
// dialog is locked to the placement's aspect, so what the operator
// sees in the cropper is exactly what the customer will see.
const PLACEMENT_META: Record<
  Placement,
  { label: string; aspect: number; aspectLabel: string; help: string }
> = {
  splash: {
    label:       "App splash (launch)",
    aspect:      9 / 16,
    aspectLabel: "9:16 portrait · ~1080×1920",
    help:        "Shown full-screen on app launch. Most-recent active wins.",
  },
  home: {
    label:       "Home carousel",
    aspect:      (3 / 4) / 0.7,
    aspectLabel: "~15:14 (slightly wider than tall) · ~1200×1120",
    help:        "Auto-rotating banner on the home page. All active posters appear.",
  },
  "pos-display": {
    label:       "POS customer screen",
    aspect:      1080 / 1440,
    aspectLabel: "3:4 portrait · ~1080×1440",
    help:        "Auto-rotating portrait card shown beside the rewards panel on the counter's customer screen while idle. Drives sign-up + AOV upsells.",
  },
};

// Resize splash images to a max long-edge of 1440px and re-encode as JPEG
// at quality 0.85. iPhones at 3x are ~1290 wide; bigger source images burn
// upload bandwidth without visible benefit. Skip the resize if the input
// is already small enough or not a raster format the canvas can handle.
async function resizeForSplash(file: File): Promise<File> {
  const MAX = 1440;
  const QUALITY = 0.85;

  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size < 200 * 1024) return file; // already small

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY)
  );
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

const empty: Form = {
  id: "",
  imageUrl: "",
  title: "",
  deeplink: "",
  durationMs: 2500,
  active: false,
  startsAt: "",
  endsAt: "",
  placement: "home",
  composerState: null,
  originalBgUrl: null,
  round: "",
};

// ---- Schedule helpers ---------------------------------------------------
// All date inputs in the form are <input type="datetime-local"> which
// stores values as "YYYY-MM-DDTHH:mm" in the operator's local timezone.
// These helpers keep preset / status logic consistent with that format.
function toDtLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Status pill semantics, derived from active flag + scheduling window:
//   - !active                       → "draft"     (grey)
//   - active, starts_at in future   → "scheduled" (blue, shows date)
//   - active, ends_at in past       → "expired"   (grey, shows date)
//   - active, in-window or no dates → "live"      (green)
type ScheduleStatus =
  | { kind: "draft" }
  | { kind: "live" }
  | { kind: "scheduled"; startsAt: string }
  | { kind: "expired";   endsAt:   string };

function scheduleStatusOf(p: Poster, now = new Date()): ScheduleStatus {
  if (!p.active) return { kind: "draft" };
  const nowIso = now.toISOString();
  if (p.starts_at && p.starts_at > nowIso) {
    return { kind: "scheduled", startsAt: p.starts_at };
  }
  if (p.ends_at && p.ends_at < nowIso) {
    return { kind: "expired", endsAt: p.ends_at };
  }
  return { kind: "live" };
}

// Compact "Apr 12" / "Apr 12 · 14:30" formatter for the status pill.
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---- Deeplink picker helpers -------------------------------------------
// The poster's deeplink is whatever string the customer app passes to
// router.push(). We surface a curated dropdown of the common targets so
// operators don't have to remember path syntax or hunt for product IDs.
// The selected value still serialises to a plain string path on the wire.
const STATIC_DEEPLINK_PAGES: { value: string; label: string }[] = [
  { value: "/",              label: "Home" },
  { value: "/menu",          label: "Menu" },
  { value: "/rewards",       label: "Rewards" },
  { value: "/tier-benefits", label: "Tier benefits" },
  { value: "/store",         label: "Outlets / Store info" },
  { value: "/referral",      label: "Referral · Invite friends" },
  { value: "/orders",        label: "My orders" },
  { value: "/account",       label: "Account" },
  { value: "/cart",          label: "Cart" },
  { value: "/support",       label: "Support" },
  { value: "/wrapped",       label: "Annual rewind (Wrapped)" },
];

// Sentinels for the <select> — kept separate from real paths so we can
// distinguish "the operator picked Product…" from "the operator wrote
// the literal path /product".
const DEEPLINK_SENTINEL = {
  NONE:    "__none__",
  PRODUCT: "__product__",
  CUSTOM:  "__custom__",
} as const;

// Map a stored deeplink string back to the right select option so the
// form rehydrates correctly when editing an existing poster.
function classifyDeeplink(d: string): { kind: "none" } | { kind: "static"; value: string } | { kind: "product"; id: string } | { kind: "custom" } {
  if (!d) return { kind: "none" };
  const m = d.match(/^\/product\/([^/?#]+)/);
  if (m) return { kind: "product", id: m[1] };
  if (STATIC_DEEPLINK_PAGES.some((p) => p.value === d)) {
    return { kind: "static", value: d };
  }
  return { kind: "custom" };
}

type PickerProduct = { id: string; name: string; category: string | null };

export default function SplashPostersPage() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(empty);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Surface filter — defaults to "all". 'splash' shows splash + both,
  // Defaults to "home" since that's where most posters live (the
  // home carousel rotates all active posters; splash only shows the
  // most-recent active). Two-tab filter — the "All" combined view
  // wasn't useful in practice once each placement got its own
  // bucket-scoped sort_order.
  const [tab, setTab] = useState<Placement>("home");
  // Crop-flow source. When the user picks a file (or hits "Re-crop"
  // on an existing image), we put it here and open the cropper. The
  // cropped output flows back through handleUpload so the rest of the
  // upload pipeline is unchanged.
  const [cropSource, setCropSource] = useState<File | string | null>(null);
  // AI Composer source. Holds the bg URL (the already-cropped form image)
  // while the composer is open. When it returns a flattened JPEG, we send
  // it through the same handleUpload pipeline as a manual upload.
  const [composeSource, setComposeSource] = useState<string | null>(null);
  // Product cache for the deeplink picker. Lazily fetched the first
  // time the operator chooses "Specific product…" from the deeplink
  // dropdown — keeps the splash-posters page fast on initial load.
  const [products, setProducts] = useState<PickerProduct[] | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const ensureProducts = async () => {
    if (products || productsLoading) return;
    setProductsLoading(true);
    try {
      const res = await adminFetch("/api/pickup/products");
      const json = await res.json();
      // /api/pickup/products returns { products, categories }. Products
      // carry `category_id` (not `category`), so we resolve human-readable
      // category names via the categories array — operators see "Coffee"
      // not "coffee-hot-uuid".
      const cats: Array<{ id: string; name: string }> = Array.isArray(json.categories)
        ? json.categories
        : [];
      const catById = new Map(cats.map((c) => [String(c.id), String(c.name)] as const));
      if (Array.isArray(json.products)) {
        type ApiProduct = { id: string; name: string; category_id?: string };
        setProducts(
          (json.products as ApiProduct[]).map((p) => ({
            id:       String(p.id),
            name:     String(p.name),
            category: p.category_id ? (catById.get(String(p.category_id)) ?? p.category_id) : null,
          })),
        );
      } else {
        setProducts([]);
      }
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  // UI-only override for the deeplink picker's current mode. When null,
  // the select derives its value from classifyDeeplink(form.deeplink).
  // When the operator picks "Specific product…" or "Custom path…", we
  // pin the mode here so the picker stays open even while form.deeplink
  // is briefly empty (between choosing the mode and the product). Reset
  // on openNew / openEdit so editing an existing poster classifies
  // correctly from its saved deeplink.
  const [deeplinkMode, setDeeplinkMode] = useState<"product" | "custom" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/pickup/splash-posters");
      const json = await res.json();
      setPosters(json.posters ?? []);
    } catch (e) {
      toast.error("Failed to load posters");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setForm(empty);
    setDeeplinkMode(null);
    setShowForm(true);
  };

  const openEdit = (p: Poster) => {
    setForm({
      id: p.id,
      imageUrl: p.image_url,
      title: p.title ?? "",
      deeplink: p.deeplink ?? "",
      durationMs: p.duration_ms,
      active: p.active,
      startsAt: p.starts_at ?? "",
      endsAt: p.ends_at ?? "",
      placement: p.placement ?? "home",
      composerState: p.composer_state ?? null,
      originalBgUrl: p.original_bg_url ?? null,
      round: p.round ?? "",
    });
    setDeeplinkMode(null);
    setShowForm(true);
    // If this poster already deeplinks to a specific product, pre-warm
    // the catalog so the picker is ready when the modal opens.
    if (classifyDeeplink(p.deeplink ?? "").kind === "product") {
      void ensureProducts();
    }
  };

  // Clone an existing poster into a new draft. Copies image, composition,
  // schedule fields, and placement; resets title to "Copy of ...",
  // forces active=false, and clears sort_order (server picks fresh).
  // Customer-app safe — the clone is OFF on creation.
  const duplicate = async (p: Poster) => {
    try {
      const payload = {
        imageUrl:       p.image_url,
        title:          p.title ? `Copy of ${p.title}` : "Copy",
        deeplink:       p.deeplink ?? null,
        durationMs:     p.duration_ms,
        active:         false,
        startsAt:       p.starts_at ?? null,
        endsAt:         p.ends_at ?? null,
        placement:      p.placement ?? "home",
        composerState:  p.composer_state ?? null,
        originalBgUrl:  p.original_bg_url ?? null,
        round:          p.round ?? null,
      };
      const res = await adminFetch("/api/pickup/splash-posters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Duplicate failed");
      toast.success("Duplicated — saved as draft");
      load();
    } catch {
      toast.error("Couldn't duplicate");
    }
  };

  // Two upload entry points share this — the manual cropper (which
  // returns a flat bg image with no layers) and the AI composer (which
  // returns a flattened poster plus the editable ComposerState). The
  // optional composerState arg captures the latter so we can persist
  // both the image and the editable state in one save.
  const handleUpload = async (file: File, composerState: ComposerState | null = null) => {
    setUploading(true);
    try {
      // Auto-resize big images on the client before upload — keeps Cloudinary
      // usage reasonable + uploads finish faster on slow connections.
      const resized = await resizeForSplash(file);
      const fd = new FormData();
      fd.append("file", resized);
      fd.append("kind", "poster");
      const res = await adminFetch("/api/pickup/upload-image", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      // Two distinct upload origins call this:
      //   - Manual Re-crop (composerState arg is null): the new file IS
      //     a clean background, so we lock it into originalBgUrl as
      //     the canonical anchor for future AI compose. composerState
      //     is cleared since the new bg has no layers yet.
      //   - AI composer save (composerState arg present): the new file
      //     is a flattened JPEG with text baked in, so we DO NOT touch
      //     originalBgUrl. composerState replaces the prior state.
      setForm((f) => ({
        ...f,
        imageUrl:      json.url,
        composerState,
        originalBgUrl: composerState ? f.originalBgUrl : json.url,
      }));
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Drop an image file");
      return;
    }
    // Open the cropper instead of uploading straight away — the
    // operator positions the image inside the placement's window
    // before we hit Cloudinary.
    setCropSource(file);
  };

  const save = async () => {
    if (!form.imageUrl) {
      toast.error("Image required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        imageUrl:      form.imageUrl,
        title:         form.title || null,
        deeplink:      form.deeplink || null,
        durationMs:    form.durationMs,
        active:        form.active,
        startsAt:      form.startsAt || null,
        endsAt:        form.endsAt || null,
        placement:     form.placement,
        composerState: form.composerState,
        originalBgUrl: form.originalBgUrl,
        round:         form.placement === "pos-display" ? (form.round || null) : null,
      };
      const url = form.id
        ? `/api/pickup/splash-posters?id=${encodeURIComponent(form.id)}`
        : "/api/pickup/splash-posters";
      const res = await adminFetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast.success(form.id ? "Poster updated" : "Poster created");
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: Poster) => {
    try {
      const res = await adminFetch(
        `/api/pickup/splash-posters?id=${encodeURIComponent(p.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !p.active }),
        }
      );
      if (!res.ok) throw new Error("Failed");
      load();
    } catch {
      toast.error("Failed to toggle");
    }
  };

  // Move a poster up or down within its placement bucket. The carousel
  // on the customer home page renders in sort_order ascending, so "up"
  // here = appears earlier in the rotation. Reorder POST sends the full
  // sequence (within the same placement) so the server can rewrite
  // sort_order in one pass with stable 10-step increments.
  const reorder = async (p: Poster, direction: "up" | "down") => {
    const placement = p.placement ?? "home";
    const peers = posters.filter((q) => (q.placement ?? "home") === placement);
    const idx = peers.findIndex((q) => q.id === p.id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= peers.length) return;

    const next = peers.slice();
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const orderedIds = next.map((q) => q.id);

    // Optimistic local update so the UI moves instantly; load() reconciles.
    setPosters((prev) => {
      const byId = new Map(prev.map((q) => [q.id, q] as const));
      const reorderedInBucket = next;
      const others = prev.filter((q) => (q.placement ?? "home") !== placement);
      return [...reorderedInBucket, ...others].map((q) => byId.get(q.id) ?? q);
    });

    try {
      const res = await adminFetch("/api/pickup/splash-posters/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error("Reorder failed");
      load();
    } catch {
      toast.error("Couldn't reorder — refreshing.");
      load();
    }
  };

  const del = async (p: Poster) => {
    const ok = await confirm({
      title: "Delete poster?",
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(p.id);
    try {
      const res = await adminFetch(
        `/api/pickup/splash-posters?id=${encodeURIComponent(p.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed");
      load();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-3 sm:p-6">
      <ConfirmDialog />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Posters</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Splash = launch screen (one active wins). Home = carousel banners (all active rotate).
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
        >
          <Plus className="h-4 w-4" />
          New poster
        </button>
      </div>

      {/* Surface filter — Home / Splash only. Counts shown per tab so
          an operator scanning the list knows how many are scheduled on
          each surface at a glance. */}
      {!loading && posters.length > 0 && (() => {
        const splashCount = posters.filter((p) => (p.placement ?? "home") === "splash").length;
        const homeCount   = posters.filter((p) => (p.placement ?? "home") === "home").length;
        const posCount    = posters.filter((p) => (p.placement ?? "home") === "pos-display").length;
        const tabs: { id: Placement; label: string; count: number }[] = [
          { id: "home",        label: "Home",        count: homeCount   },
          { id: "splash",      label: "Splash",      count: splashCount },
          { id: "pos-display", label: "POS screen",  count: posCount    },
        ];
        return (
          <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.id
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-[10px] ${tab === t.id ? "text-gray-500" : "text-gray-400"}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      {(() => {
        // Filtering rule: 'splash' tab shows posters whose placement is
        // Filter by selected placement bucket. Splash and home are
        // exclusive — splash shows the most-recent active poster on
        // launch, home rotates active home posters in the carousel.
        const filtered = posters.filter((p) => (p.placement ?? "home") === tab);

        if (loading) {
          return (
            <div className="flex h-40 items-center justify-center text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          );
        }
        if (posters.length === 0) {
          return (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-12 text-center">
              <p className="text-sm text-gray-500">No posters yet.</p>
              <button
                onClick={openNew}
                className="mt-3 text-sm font-medium text-terracotta hover:underline"
              >
                Create your first poster
              </button>
            </div>
          );
        }
        if (filtered.length === 0) {
          return (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
              <p className="text-sm text-gray-500">
                No posters scheduled on {tab === "splash" ? "Splash" : tab === "pos-display" ? "POS screen" : "Home"}.
              </p>
              <button
                onClick={() => { setForm({ ...empty, placement: tab as Placement }); setShowForm(true); }}
                className="mt-3 text-sm font-medium text-terracotta hover:underline"
              >
                Add one
              </button>
            </div>
          );
        }
        return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const placement = (p.placement ?? "home") as Placement;
            // Preview at the placement's natural aspect so the operator
            // sees what the customer will see on each surface.
            const aspectClass =
              placement === "home"
                ? "aspect-[15/14]"
                : placement === "pos-display"
                  ? "aspect-[3/4]"
                  : "aspect-[9/16]";
            const placementLabel =
              placement === "splash" ? "SPLASH" : placement === "pos-display" ? "POS" : "HOME";
            const placementColor =
              placement === "splash"
                ? "bg-indigo-500"
                : placement === "pos-display"
                  ? "bg-emerald-600"
                  : "bg-amber-500";
            return (
            <div
              key={p.id}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              <div className={`relative ${aspectClass} bg-gray-100`}>
                {p.image_url && (
                  <img
                    src={bust(p.image_url, p.updated_at)}
                    alt={p.title ?? ""}
                    className="h-full w-full object-cover"
                  />
                )}
                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  <span className={`rounded-full ${placementColor} px-2 py-0.5 text-[10px] font-semibold text-white`}>
                    {placementLabel}
                  </span>
                  {p.round && (
                    <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-semibold capitalize text-white">
                      {p.round}
                    </span>
                  )}
                  {/* Schedule status pill — replaces the bare ACTIVE
                      pill with one that conveys the real live state:
                      LIVE NOW, SCHEDULED · Apr 12, EXPIRED · Mar 30,
                      or DRAFT when the active toggle is off. Lets the
                      operator scan a long poster list and know what's
                      actually showing to customers right now. */}
                  {(() => {
                    const status = scheduleStatusOf(p);
                    switch (status.kind) {
                      case "live":
                        return (
                          <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                            LIVE NOW
                          </span>
                        );
                      case "scheduled":
                        return (
                          <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                            SCHEDULED · {shortDate(status.startsAt)}
                          </span>
                        );
                      case "expired":
                        return (
                          <span className="rounded-full bg-gray-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                            EXPIRED · {shortDate(status.endsAt)}
                          </span>
                        );
                      case "draft":
                      default:
                        return (
                          <span className="rounded-full bg-gray-400/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                            DRAFT
                          </span>
                        );
                    }
                  })()}
                </div>
                {/* Reorder controls — operator clicks ↑ / ↓ to nudge
                    a poster earlier or later in the home carousel
                    rotation. Up = appears sooner, Down = appears later.
                    Disabled at the bucket boundaries. Placement label
                    bucket (splash vs home) is preserved; reorder only
                    moves within the same placement. */}
                {(() => {
                  const peers = posters.filter((q) => (q.placement ?? "home") === placement);
                  const peerIdx = peers.findIndex((q) => q.id === p.id);
                  const canUp = peerIdx > 0;
                  const canDown = peerIdx >= 0 && peerIdx < peers.length - 1;
                  return (
                    <div className="absolute right-2 top-2 flex flex-col gap-1">
                      <button
                        onClick={() => reorder(p, "up")}
                        disabled={!canUp}
                        title="Move up in the carousel"
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => reorder(p, "down")}
                        disabled={!canDown}
                        title="Move down in the carousel"
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })()}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {p.title || "(untitled)"}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {p.deeplink ? `Tap → ${p.deeplink}` : "No deeplink"} · {p.duration_ms}ms
                </p>
                {(p.starts_at || p.ends_at) && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-gray-400">
                    <Clock className="h-3 w-3" />
                    {p.starts_at ? new Date(p.starts_at).toLocaleDateString() : "—"} →{" "}
                    {p.ends_at ? new Date(p.ends_at).toLocaleDateString() : "—"}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => toggleActive(p)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${
                      p.active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    <Power className="h-3 w-3" />
                    {p.active ? "On" : "Off"}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    title="Edit poster"
                    className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-1.5 text-gray-700"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {/* Duplicate — clones the poster as an inactive draft.
                      Carries over image, composition state, schedule, and
                      placement so creating a variant (different copy
                      week, different language, A/B test) is one click +
                      a tweak instead of a fresh upload + re-compose. */}
                  <button
                    onClick={() => duplicate(p)}
                    title="Duplicate as draft"
                    className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-1.5 text-gray-700"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => del(p)}
                    disabled={deleting === p.id}
                    title="Delete poster"
                    className="flex items-center justify-center rounded-lg border border-red-200 bg-white p-1.5 text-red-600 disabled:opacity-50"
                  >
                    {deleting === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
        );
      })()}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {form.id ? "Edit poster" : "New poster"}
              </h3>
              <button onClick={() => setShowForm(false)}>
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Placement first — choosing it sets the aspect-ratio
                  template for the upload preview below. Saves the
                  operator from realising mid-upload that splash and
                  home need different crops. */}
              <div>
                <label className="text-xs font-medium text-gray-700">
                  Where it shows
                </label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {(["splash", "home", "pos-display"] as Placement[]).map((p) => {
                    const meta = PLACEMENT_META[p];
                    const selected = form.placement === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            placement: p,
                            // Sensible default per surface — splash is a
                            // quick flash, home posters linger.
                            // Sensible defaults: home auto-rotates so 5s
                            // gives a beat to read the poster; splash is
                            // a one-shot flash so 2.5s feels brand-new.
                            durationMs:
                              !f.id && (f.durationMs === 2500 || f.durationMs === 4500 || f.durationMs === 5000)
                                ? p === "splash" ? 2500 : 5000
                                : f.durationMs,
                          }))
                        }
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          selected
                            ? "border-terracotta bg-terracotta/5"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <p className={`text-sm font-semibold ${selected ? "text-terracotta" : "text-gray-900"}`}>
                          {p === "splash" ? "Splash" : p === "pos-display" ? "POS screen" : "Home"}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-500 leading-tight">
                          {meta.aspectLabel}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  {PLACEMENT_META[form.placement].help}
                </p>
              </div>

              {form.placement === "pos-display" && (
                <div>
                  <label className="text-xs font-medium text-gray-700">Round (time of day)</label>
                  <select
                    value={form.round}
                    onChange={(e) => setForm((f) => ({ ...f, round: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Always — show in every round</option>
                    <option value="breakfast">Breakfast · 8–10AM</option>
                    <option value="brunch">Brunch · 10AM–12PM</option>
                    <option value="lunch">Lunch · 12–3PM</option>
                    <option value="midday">Midday · 3–5PM</option>
                    <option value="evening">Evening · 5–7PM</option>
                    <option value="dinner">Dinner · 7–9PM</option>
                    <option value="supper">Supper · 9–11PM</option>
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Only shows on the customer screen during this day-part. &quot;Always&quot; shows in every round.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-700">
                  Image · {PLACEMENT_META[form.placement].aspectLabel} · auto-resized to 1440px max
                </label>
                <div className="mt-1 flex items-start gap-3">
                  {form.imageUrl ? (
                    /* In-app preview — for 'home' we mock the live hero
                       (poster + espresso info card) so the operator sees
                       exactly what the customer will see, including how
                       the rounded card crops the bottom of their image.
                       'splash' renders full-bleed since the launch has
                       no overlay. */
                    <div className="relative">
                      <div
                        className={`relative overflow-hidden rounded-lg bg-gray-100 ${
                          form.placement === "home"
                            ? "h-52 w-[235px]"
                            : "h-72 w-40"
                        }`}
                      >
                        <img
                          src={bust(form.imageUrl, form.id || Date.now())}
                          alt=""
                          className="h-full w-full object-cover"
                        />

                        {/* Mock espresso info card — only on home. Small
                            floating box with mx-4 + rounded on all sides,
                            sits near the bottom of the poster with the
                            photo extending fully behind it. Mirrors the
                            shipped app geometry. */}
                        {form.placement === "home" && (
                          <div
                            className="absolute inset-x-3 bottom-2 rounded-xl px-3 pb-2 pt-2.5 shadow-2xl"
                            style={{ backgroundColor: "#160800" }}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className="truncate text-[11px] text-white"
                                style={{ fontFamily: "Peachi-Bold, serif" }}
                              >
                                Hi, Friend.
                              </span>
                              <span className="text-[8px] font-bold tracking-wider text-amber-400">
                                ✦ MEMBER
                              </span>
                            </div>
                            <div className="mt-2 flex items-center border-t border-white/10 pt-2">
                              <div className="flex-1">
                                <div className="text-[10px] font-bold text-white">3,214</div>
                                <div className="text-[7px] uppercase tracking-wider text-white/55">
                                  Points
                                </div>
                              </div>
                              <div className="flex-1 border-l border-white/10 pl-2">
                                <div className="text-[10px] font-bold text-amber-400">2</div>
                                <div className="text-[7px] uppercase tracking-wider text-white/55">
                                  Vouchers
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Re-crop pulls the live image URL back into the
                          cropper so the operator can reposition / re-zoom
                          without having to re-pick the source file. */}
                      <button
                        type="button"
                        onClick={() => setCropSource(form.imageUrl)}
                        className="absolute -bottom-3 left-2 flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-gray-700 shadow"
                        title="Reposition / re-zoom"
                      >
                        <Crop className="h-3 w-3" />
                        Re-crop
                      </button>
                      {/* AI compose / Edit composition — split paths:
                          - With saved composerState: reopens the composer
                            using composerState.bgUrl (clean, pre-rasterise)
                            + the saved layers. No stacking risk.
                          - Without composerState: hard-confirm before
                            opening because the bg is whatever's in
                            form.imageUrl, which may already have text
                            baked in (legacy posters, previous AI compose
                            before composer_state existed, designer
                            uploads). Stacking would silently happen
                            otherwise. The confirm forces the operator
                            to either acknowledge "this image is clean"
                            or back out to Re-crop a fresh photo first. */}
                      <button
                        type="button"
                        onClick={() => {
                          // Bg-precedence chain:
                          //   1. composer_state.bgUrl (clean bg + layers)
                          //      — most specific, safest, includes pan/zoom.
                          //   2. originalBgUrl (clean bg from last Re-crop)
                          //      — clean image but no saved layers; AI runs
                          //      extract mode to populate.
                          //   3. imageUrl (current display, may be flat)
                          //      — TRULY legacy; warn + confirm before use
                          //      since stacking is possible.
                          if (form.composerState) {
                            setComposeSource(form.composerState.bgUrl);
                            return;
                          }
                          if (form.originalBgUrl) {
                            // We have a verified-clean bg, no need to warn.
                            setComposeSource(form.originalBgUrl);
                            return;
                          }
                          const ok = window.confirm(
                            "AI compose adds NEW text on top of the background image.\n\n" +
                            "If the current image already has text in it (e.g. you previously saved this poster, or it's a designed image with words), the new text will STACK on top — every save will keep doubling.\n\n" +
                            "Continue ONLY if this image is a clean background photo with NO text.\n\n" +
                            "OK = it's clean, open the composer.\n" +
                            "Cancel = let me Re-crop with a fresh photo first."
                          );
                          if (!ok) return;
                          setComposeSource(form.imageUrl);
                        }}
                        className="absolute -bottom-3 left-[88px] flex items-center gap-1 rounded-md bg-terracotta px-2 py-1 text-[10px] font-semibold text-white shadow"
                        title={form.composerState ? "Edit composition (text, colours, positions)" : "Compose with AI"}
                      >
                        <Sparkles className="h-3 w-3" />
                        {form.composerState ? "Edit composition" : "AI compose"}
                      </button>
                      <button
                        onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                        className="absolute -right-2 -top-2 rounded-full bg-white p-1 shadow"
                      >
                        <X className="h-3 w-3 text-gray-600" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-xs transition-colors ${
                        form.placement === "home" ? "h-52" : "h-72"
                      } ${
                        dragOver
                          ? "border-terracotta bg-terracotta/5 text-terracotta"
                          : "border-gray-300 text-gray-500 hover:border-terracotta hover:bg-gray-50"
                      }`}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>Resizing & uploading…</span>
                        </>
                      ) : (
                        <>
                          <ImagePlus className="h-6 w-6" />
                          <span className="font-medium">
                            {dragOver ? "Drop to upload" : "Drop an image or click to browse"}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            JPG / PNG / WEBP · auto-resized
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Reset the input so picking the same file twice
                      // still triggers onChange the second time.
                      e.target.value = "";
                      // Open the cropper instead of going straight to
                      // upload — operator positions the image first.
                      if (file) setCropSource(file);
                    }}
                  />
                </div>
                {form.imageUrl && form.placement === "home" && (
                  <p className="mt-3 text-[10px] text-gray-400">
                    Preview shows the espresso info card overlay —
                    keep important details (logo, headline) clear of
                    the bottom 25% of the image.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">
                  Title (internal)
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="e.g. Ramadan 2026 promo"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">
                  Where tap navigates (optional)
                </label>
                {(() => {
                  // The select's value comes from one of two sources:
                  //   1. UI override (deeplinkMode) — set when the
                  //      operator just picked "Specific product…" or
                  //      "Custom path…" but hasn't typed/picked a value
                  //      yet. form.deeplink is still empty here; without
                  //      this override the select would snap back to
                  //      "No deeplink" and the picker would disappear.
                  //   2. Classification of the stored deeplink — used
                  //      when editing an existing poster and as the
                  //      stable resting state once a real value is set.
                  const classification = classifyDeeplink(form.deeplink);
                  const selectedSentinel =
                      deeplinkMode === "product" ? DEEPLINK_SENTINEL.PRODUCT
                    : deeplinkMode === "custom"  ? DEEPLINK_SENTINEL.CUSTOM
                    : classification.kind === "none"    ? DEEPLINK_SENTINEL.NONE
                    : classification.kind === "static"  ? classification.value
                    : classification.kind === "product" ? DEEPLINK_SENTINEL.PRODUCT
                    : DEEPLINK_SENTINEL.CUSTOM;
                  const selectedProductId =
                    classification.kind === "product" ? classification.id : "";

                  return (
                    <>
                      <select
                        value={selectedSentinel}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === DEEPLINK_SENTINEL.NONE) {
                            setDeeplinkMode(null);
                            setForm((f) => ({ ...f, deeplink: "" }));
                            return;
                          }
                          if (v === DEEPLINK_SENTINEL.PRODUCT) {
                            // Pin the picker open via the UI override,
                            // kick off the product fetch, and clear the
                            // path until the operator picks a product.
                            setDeeplinkMode("product");
                            void ensureProducts();
                            setForm((f) => ({ ...f, deeplink: "" }));
                            return;
                          }
                          if (v === DEEPLINK_SENTINEL.CUSTOM) {
                            setDeeplinkMode("custom");
                            // Keep existing value if it's already custom;
                            // otherwise blank so the input shows clearly.
                            setForm((f) => ({
                              ...f,
                              deeplink:
                                classifyDeeplink(f.deeplink).kind === "custom"
                                  ? f.deeplink
                                  : "",
                            }));
                            return;
                          }
                          // Static page path — drop the UI override.
                          setDeeplinkMode(null);
                          setForm((f) => ({ ...f, deeplink: v }));
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value={DEEPLINK_SENTINEL.NONE}>
                          — No deeplink (tap does nothing) —
                        </option>
                        <optgroup label="Pages">
                          {STATIC_DEEPLINK_PAGES.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Dynamic">
                          <option value={DEEPLINK_SENTINEL.PRODUCT}>
                            Specific product…
                          </option>
                          <option value={DEEPLINK_SENTINEL.CUSTOM}>
                            Custom path…
                          </option>
                        </optgroup>
                      </select>

                      {/* Product picker — shown only when "Specific
                          product…" is selected. Loads the catalog
                          lazily so the form stays fast otherwise. */}
                      {selectedSentinel === DEEPLINK_SENTINEL.PRODUCT && (
                        <div className="mt-2">
                          {productsLoading ? (
                            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Loading product catalog…
                            </div>
                          ) : products && products.length > 0 ? (
                            <select
                              value={selectedProductId}
                              onChange={(e) => {
                                const id = e.target.value;
                                setForm((f) => ({
                                  ...f,
                                  deeplink: id ? `/product/${id}` : "",
                                }));
                              }}
                              onFocus={() => void ensureProducts()}
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                            >
                              <option value="">— Pick a product —</option>
                              {(() => {
                                // Group by category so a long list scans
                                // easily ("Coffee", "Tea", "Bites", …).
                                const byCat = new Map<string, PickerProduct[]>();
                                for (const p of products) {
                                  const cat = p.category || "Other";
                                  const arr = byCat.get(cat) ?? [];
                                  arr.push(p);
                                  byCat.set(cat, arr);
                                }
                                return [...byCat.entries()]
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([cat, items]) => (
                                    <optgroup key={cat} label={cat}>
                                      {items
                                        .slice()
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map((p) => (
                                          <option key={p.id} value={p.id}>
                                            {p.name}
                                          </option>
                                        ))}
                                    </optgroup>
                                  ));
                              })()}
                            </select>
                          ) : (
                            <p className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500">
                              No products available.
                            </p>
                          )}
                          {form.deeplink && (
                            <p className="mt-1 text-[10px] text-gray-400">
                              Resolved path: <code className="font-mono">{form.deeplink}</code>
                            </p>
                          )}
                        </div>
                      )}

                      {/* Custom-path escape hatch — for power users
                          targeting routes the dropdown doesn't cover
                          (challenge swap, debug routes, etc). */}
                      {selectedSentinel === DEEPLINK_SENTINEL.CUSTOM && (
                        <input
                          type="text"
                          value={form.deeplink}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, deeplink: e.target.value }))
                          }
                          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
                          placeholder="/challenge/abc/swap"
                          autoFocus
                        />
                      )}
                    </>
                  );
                })()}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">
                  Show duration ({(form.durationMs / 1000).toFixed(1)}s)
                </label>
                <input
                  type="range"
                  min={1000}
                  max={10000}
                  step={500}
                  value={form.durationMs}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, durationMs: Number(e.target.value) }))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div>
                {/* Schedule presets — quick buttons for the common
                    F&B scheduling windows. Click sets both startsAt
                    and endsAt to sensible bounds in the operator's
                    local timezone. "Clear" wipes both to leave the
                    poster on indefinitely while active. */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Schedule:
                  </span>
                  {([
                    {
                      label: "Today only",
                      apply: () => {
                        const start = new Date();
                        start.setHours(0, 0, 0, 0);
                        const end = new Date();
                        end.setHours(23, 59, 0, 0);
                        return { startsAt: toDtLocal(start), endsAt: toDtLocal(end) };
                      },
                    },
                    {
                      label: "Next 7 days",
                      apply: () => {
                        const start = new Date();
                        const end = new Date();
                        end.setDate(end.getDate() + 7);
                        return { startsAt: toDtLocal(start), endsAt: toDtLocal(end) };
                      },
                    },
                    {
                      label: "Next 30 days",
                      apply: () => {
                        const start = new Date();
                        const end = new Date();
                        end.setDate(end.getDate() + 30);
                        return { startsAt: toDtLocal(start), endsAt: toDtLocal(end) };
                      },
                    },
                    {
                      label: "Clear",
                      apply: () => ({ startsAt: "", endsAt: "" }),
                    },
                  ] as const).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        const { startsAt, endsAt } = preset.apply();
                        setForm((f) => ({ ...f, startsAt, endsAt }));
                      }}
                      className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:border-terracotta hover:text-terracotta"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-700">
                      Starts at (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, startsAt: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">
                      Ends at (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, endsAt: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Inverted-range warning — silent until it actually
                    happens, so we don't yell at operators while they're
                    typing. */}
                {form.startsAt && form.endsAt && form.endsAt < form.startsAt && (
                  <p className="mt-1.5 text-[11px] text-red-600">
                    End date is before start date — the poster won&apos;t be visible at any time.
                  </p>
                )}
              </div>

              <div
                className={`mt-1 flex items-center justify-between rounded-xl border p-3 ${
                  form.active
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-gray-200 bg-gray-50"
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {form.active ? "Active in app" : "Inactive (draft)"}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {form.placement === "home"
                      ? "All active home posters rotate in the carousel"
                      : "Most-recent active splash poster wins"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                    form.active ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      form.active ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || !form.imageUrl}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {form.id ? "Save" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Crop dialog — opens whenever cropSource is set. The output
          File flows through the existing handleUpload pipeline so the
          rest of the upload code (resize cap, /api/pickup/upload-image,
          imageUrl write) stays unchanged. */}
      {cropSource && (
        <PosterCropDialog
          source={cropSource}
          aspect={PLACEMENT_META[form.placement].aspect}
          aspectLabel={PLACEMENT_META[form.placement].aspectLabel}
          onCancel={() => setCropSource(null)}
          onSave={(file) => {
            setCropSource(null);
            handleUpload(file);
          }}
        />
      )}

      {/* AI composer — bg + tint + draggable text + AI generation. Output
          is a flattened JPEG that runs through the same upload pipeline
          as a manual crop, plus a ComposerState we persist so the next
          edit reopens the composer with these layers intact (no need to
          re-run AI compose). initialState hydrates the composer when
          editing an existing AI-composed poster — the bg comes from the
          saved state, not the current form.imageUrl (which is the flat
          rasterised output of the previous save). */}
      {composeSource && (
        <PosterComposer
          bgUrl={form.composerState?.bgUrl ?? form.originalBgUrl ?? composeSource}
          placement={form.placement}
          initialState={form.composerState ?? undefined}
          onCancel={() => setComposeSource(null)}
          onSave={(file, composerState) => {
            setComposeSource(null);
            handleUpload(file, composerState);
          }}
        />
      )}
    </div>
  );
}

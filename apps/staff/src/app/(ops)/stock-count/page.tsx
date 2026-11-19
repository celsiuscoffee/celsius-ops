"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@celsius/ui";
import { supabase } from "@/lib/supabase";
import {
  Check,
  Search,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Loader2,
  Delete,
  Users,
  AlertTriangle,
} from "lucide-react";
import { formatTime } from "@/lib/format-time";

const STORAGE_AREA_LABELS: Record<string, string> = {
  FRIDGE: "Fridge",
  DRY_STORE: "Dry Store",
  COUNTER: "Counter",
  FREEZER: "Freezer",
  BAR: "Bar",
};

interface Product {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  storageArea: string;
  categoryId: string;
  category: string;
  packages: { id: string; name: string; label: string; uom: string; conversion: number; isDefault: boolean }[];
  suppliers: { name: string; price: number; uom: string }[];
  checkFrequency: string;
}

interface UserSession {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
}

// Each item stores: counted qty + which package it was counted in
interface ItemCount {
  qty: number;
  packageId: string | null;
}

interface GroupedArea {
  area: string;
  items: Product[];
}

// Server-side view of an item from /api/stock-checks/active. Used to render
// per-item authorship ("counted by Ameir 15:32") and to send conflict-aware
// upserts (expectedPriorCountedById) so the second user gets prompted before
// overwriting another counter's value.
interface ServerItem {
  productId: string;
  productPackageId: string | null;
  countedQty: number | null;
  countedById: string | null;
  countedAt: string | null;
  countedBy: { id: string; name: string } | null;
}

interface Contributor {
  id: string;
  name: string;
  itemCount: number;
}

// 409 payload from /items endpoint when a save would overwrite someone
// else's count. The UI shows a modal prompting "Ameir already counted this
// (5). Overwrite with your value (4)?" before retrying.
interface ConflictItem {
  productId: string;
  productPackageId: string | null;
  countedById: string | null;
  countedByName: string | null;
  countedQty: number | null;
}

// Pending save the user agreed to overwrite — replayed without the
// expectedPriorCountedById guard. countedQty can be null when clearing.
interface PendingSave {
  productId: string;
  productPackageId: string | null;
  countedQty: number | null;
}

const STORAGE_KEY = "celsius-stock-check-draft-v2";

function loadDraft(freq: string): Record<string, ItemCount> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data.frequency !== freq) return {};
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    if (data.date !== today) { localStorage.removeItem(STORAGE_KEY); return {}; }
    return data.items || {};
  } catch { return {}; }
}

function saveDraft(freq: string, items: Record<string, ItemCount>) {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ frequency: freq, date: today, items }));
  } catch { /* ignore */ }
}

export default function StockCheckPage() {
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [search, setSearch] = useState("");
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, ItemCount>>(() => loadDraft("daily"));
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Keypad state
  const [keypadItem, setKeypadItem] = useState<Product | null>(null);
  const [keypadPkgId, setKeypadPkgId] = useState<string | null>(null);
  const [keypadValue, setKeypadValue] = useState("");

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Collaborative state — populated from /api/stock-checks/active
  const [countId, setCountId] = useState<string | null>(null);
  // Keyed by `${productId}:${packageId||""}` for fast conflict lookup.
  const [serverItems, setServerItems] = useState<Record<string, ServerItem>>({});
  const [submittedToday, setSubmittedToday] = useState<{
    id: string;
    submittedAt: string | null;
    finalizedAt: string | null;
    finalizedBy: { name: string } | null;
    countedBy: { name: string } | null;
  } | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<{
    conflict: ConflictItem;
    pending: PendingSave;
  } | null>(null);
  // Set to true after the user dismisses "today already submitted" with
  // "Start new count" — bypasses the read-only view for this session.
  const [startNewOverride, setStartNewOverride] = useState(false);

  // ── Expiry (soft block) ──
  // A draft left open more than a full day is not a single-date snapshot any
  // more, so the server refuses further saves until the counter decides:
  // start fresh for today, or continue and let the count be re-dated. Held in
  // state so the choice sticks for the rest of the session and every
  // subsequent save carries it.
  const [expiredCount, setExpiredCount] = useState<{
    countId: string;
    daysOpen: number;
    countDate: string | null;
  } | null>(null);
  const [expiredAction, setExpiredAction] = useState<"new" | "continue" | null>(null);
  // Finalize-time counterpart: an expired count can still be closed, but only
  // once someone states when the stock was really counted.
  const [stalePrompt, setStalePrompt] = useState<{ daysOpen: number; reason: string } | null>(null);

  // ── Schedule (soft block) ──
  // Weekly counts belong on Thursday and monthly counts on the month boundary.
  // `schedule` is read on load so the banner warns before anyone walks the
  // shelves; `schedulePrompt` is the finalize-time ask for a reason when a
  // census is being closed outside its window anyway.
  const [schedule, setSchedule] = useState<{
    offSchedule: boolean;
    expectedLabel: string;
    actualLabel: string;
  } | null>(null);
  const [schedulePrompt, setSchedulePrompt] = useState<{
    expectedLabel: string;
    actualLabel: string;
    reason: string;
  } | null>(null);
  // Reasons already given for this finalize attempt (stale / off-schedule), so
  // answering the second prompt doesn't drop the answer to the first.
  const answeredReasonsRef = useRef<{ staleReason?: string; scheduleReason?: string }>({});
  const expiredActionRef = useRef(expiredAction);
  useEffect(() => { expiredActionRef.current = expiredAction; }, [expiredAction]);

  // serverItems is also surfaced via a ref for the realtime callback,
  // which doesn't see fresh React state via closure.
  const serverItemsRef = useRef(serverItems);
  useEffect(() => { serverItemsRef.current = serverItems; }, [serverItems]);

  const serverItemKey = (productId: string, packageId: string | null) =>
    `${productId}:${packageId ?? ""}`;

  // Autosave
  useEffect(() => {
    if (Object.keys(counts).length > 0) {
      saveDraft(frequency, counts);
      setLastSaved(formatTime(Date.now()));
    }
  }, [counts, frequency]);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [productsRes, userRes] = await Promise.all([
          fetch("/api/products/options"),
          fetch("/api/auth/me"),
        ]);
        if (!productsRes.ok) throw new Error("Failed to load products");
        if (!userRes.ok) throw new Error("Failed to load user session");
        setProducts(await productsRes.json());
        setUser(await userRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // ── Active-count hydration ──
  // Fetches the in-progress DRAFT count for this outlet+frequency (or the
  // "already submitted today" stub if there isn't one). Sets countId,
  // hydrates serverItems, and overlays the server state on top of any
  // localStorage draft. Runs on mount + when frequency changes + after
  // startNewOverride flips (so finalizing then starting fresh refetches).
  const fetchActive = useCallback(async () => {
    if (!user?.outletId) return;
    try {
      const res = await fetch(`/api/stock-checks/active?frequency=${frequency.toUpperCase()}`);
      if (!res.ok) return;
      const data: {
        active: {
          id: string;
          items: ServerItem[];
          countDate?: string | null;
          expired?: boolean;
          daysOpen?: number;
        } | null;
        submittedToday: typeof submittedToday;
        schedule?: { offSchedule: boolean; expectedLabel: string; actualLabel: string };
      } = await res.json();

      setSchedule(data.schedule ?? null);

      // "Start a new count" was chosen but nothing has been keyed yet, so the
      // expired draft is still the newest one on the server. Ignore it —
      // otherwise the 3-second poll re-hydrates the very count we abandoned.
      if (data.active?.expired && expiredActionRef.current === "new") {
        setCountId(null);
        setServerItems({});
        setExpiredCount(null);
        setSubmittedToday(null);
        return;
      }

      if (data.active) {
        setCountId(data.active.id);
        // Surface the soft block on open, so nobody keys a quantity into a
        // day-old count only to have it bounce. Cleared once they choose.
        setExpiredCount(
          data.active.expired && !expiredActionRef.current
            ? {
                countId: data.active.id,
                daysOpen: data.active.daysOpen ?? 1,
                countDate: data.active.countDate ?? null,
              }
            : null,
        );
        const map: Record<string, ServerItem> = {};
        for (const it of data.active.items) {
          map[serverItemKey(it.productId, it.productPackageId)] = it;
        }
        setServerItems(map);

        // Reconcile local draft with server truth — server wins for items
        // we already know about; local-only items (offline edits) survive.
        setCounts((prev) => {
          const next = { ...prev };
          for (const it of data.active!.items) {
            if (it.countedQty != null) {
              next[it.productId] = {
                qty: Number(it.countedQty),
                packageId: it.productPackageId,
              };
            }
          }
          return next;
        });
        setSubmittedToday(null);
      } else {
        setCountId(null);
        setServerItems({});
        setExpiredCount(null);
        setSubmittedToday(data.submittedToday ?? null);
      }
    } catch {
      /* swallow — offline or transient; localStorage still works */
    }
  }, [frequency, user?.outletId]);

  useEffect(() => {
    if (!loading && user) fetchActive();
  }, [loading, user, fetchActive, startNewOverride]);

  // ── Realtime subscription ──
  // Subscribes to INSERT/UPDATE/DELETE on StockCountItem filtered by the
  // active countId, so other contributors' saves appear without refresh.
  // Channel is torn down on countId change / unmount.
  //
  // Best-effort. iOS Safari PWA (and Firefox private mode, content blockers,
  // etc.) can throw synchronously from `new WebSocket(...)` with "The
  // operation is insecure" or similar — that propagates out of supabase-js's
  // .subscribe() into the React render tree and trips the global error
  // boundary ("Something went wrong"). The polling fallback below already
  // covers peer updates, so wrap and swallow.
  useEffect(() => {
    if (!countId) return;
    if (typeof WebSocket === "undefined") return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`stock-count-${countId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "StockCountItem",
            filter: `stockCountId=eq.${countId}`,
          },
          () => {
            fetchActive();
          },
        )
        .subscribe();
    } catch {
      channel = null;
    }
    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch { /* ignore */ }
      }
    };
  }, [countId, fetchActive]);

  // ── Polling fallback ──
  // Refetches the active count every 3 seconds while there's a DRAFT in
  // progress. Cheap (small JSON payload, ~5–10 KB for 235 items) and
  // unconditional — works regardless of realtime config. Pauses when the
  // tab is hidden (PWA backgrounded) to save battery + cellular data.
  //
  // Defensive: if `document`/`window` is unexpectedly unavailable (e.g.
  // during SSR or some browser sandbox), bail rather than crash the tree.
  useEffect(() => {
    if (!countId) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      fetchActive();
    };
    let interval: number | null = null;
    const onVisibility = () => { if (!document.hidden) fetchActive(); };
    try {
      interval = window.setInterval(tick, 3000);
      document.addEventListener("visibilitychange", onVisibility);
    } catch { /* ignore */ }
    return () => {
      cancelled = true;
      if (interval !== null) {
        try { window.clearInterval(interval); } catch { /* ignore */ }
      }
      try { document.removeEventListener("visibilitychange", onVisibility); } catch { /* ignore */ }
    };
  }, [countId, fetchActive]);

  // Group + filter by frequency.
  //
  // Only the DAILY sheet is a subset — the short list of fast movers the team
  // walks every morning (owner's call 2026-08-06: beans, milk, ice hot, roti,
  // udang, cooking cream, duck, lamb). WEEKLY and MONTHLY are both a full
  // census of every product, so `checkFrequency` decides one thing only:
  // whether an item appears on the daily sheet.
  //
  // Weekly used to list only DAILY+WEEKLY items, which meant the weekly count
  // could never see the bulk of the store and no shrinkage figure could be
  // derived from it.
  const groupedData: GroupedArea[] = useMemo(() => {
    const freqKey = frequency.toUpperCase();
    const filtered = freqKey === "DAILY"
      ? products.filter((p) => p.checkFrequency === "DAILY")
      : products;
    const groups: Record<string, Product[]> = {};
    for (const p of filtered) {
      const area = p.storageArea || "UNCATEGORIZED";
      if (!groups[area]) groups[area] = [];
      groups[area].push(p);
    }
    const knownOrder = ["FRIDGE", "COUNTER", "DRY_STORE", "FREEZER", "BAR"];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((area) => ({ area, items: groups[area] }));
  }, [products, frequency]);

  const displayLabel = (area: string) =>
    STORAGE_AREA_LABELS[area] || area.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Pick the smallest-conversion package as default for counting. The old
  // logic defaulted to the BULK (non-default) package on monthly counts,
  // which caused unit-confusion bugs: staff typed "31" intending 31 bottles
  // but the system multiplied by 24,000g/Carton → 744kg stored.
  //
  // Always defaulting to the smallest package matches how staff physically
  // count (individual bottles/packs/rolls), and they can still tap up to a
  // bigger package via the selector if needed. The conversion preview under
  // the keypad shows the resulting base-UOM total either way.
  const getDefaultPkg = useCallback((product: Product) => {
    if (product.packages.length === 0) return null;
    // Smallest conversion first; ties broken by isDefault flag.
    return [...product.packages].sort((a, b) => {
      const diff = a.conversion - b.conversion;
      if (diff !== 0) return diff;
      return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
    })[0];
  }, []);

  // The unit a fresh count of this product opens in. Piece-based products
  // default to LOOSE PIECES (packageId null → factor 1): bread only had a
  // "10pcs Loaf" (×10) line, staff keyed piece numbers into it, and every
  // bread count landed 10× inflated — Aug 2026's fake "3-6× bread usage"
  // finding. Staff physically count pieces; the pack options stay one tap
  // away in the selector for stock that really is in sealed packs.
  const getDefaultUnit = useCallback(
    (product: Product): { id: string | null; label: string } => {
      if (product.packages.length === 0 || product.baseUom === "pcs") {
        return { id: null, label: product.baseUom };
      }
      const pkg = getDefaultPkg(product)!;
      return { id: pkg.id, label: pkg.label || pkg.name };
    },
    [getDefaultPkg],
  );

  // packageId semantics: a string = that package's units; null = loose base
  // units (explicitly chosen, factor 1); undefined = not counted yet, show
  // the default unit.
  const getUomLabel = useCallback((product: Product, packageId?: string | null) => {
    if (packageId) {
      const pkg = product.packages.find((p) => p.id === packageId);
      if (pkg) return pkg.label || pkg.name;
    }
    if (packageId === null) return product.baseUom;
    return getDefaultUnit(product).label;
  }, [getDefaultUnit]);

  const totalItems = groupedData.reduce((acc, g) => acc + g.items.length, 0);
  const countedItems = groupedData.reduce((acc, g) => acc + g.items.filter((i) => counts[i.id] != null).length, 0);
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  // Derived contributors strip: tally distinct counters from serverItems.
  // Empty until the first save lands on the server.
  const contributors: Contributor[] = useMemo(() => {
    const tally = new Map<string, Contributor>();
    for (const it of Object.values(serverItems)) {
      if (!it.countedBy) continue;
      const cur = tally.get(it.countedBy.id);
      if (cur) cur.itemCount += 1;
      else tally.set(it.countedBy.id, { id: it.countedBy.id, name: it.countedBy.name, itemCount: 1 });
    }
    // Stable sort: most contributions first, then name.
    return Array.from(tally.values()).sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name));
  }, [serverItems]);

  // ── Keypad ──
  const openKeypad = (product: Product) => {
    const existing = counts[product.id];
    setKeypadItem(product);
    // An existing count keeps its unit as-is — including an explicit null
    // (loose base units), which `|| default` would silently override.
    setKeypadPkgId(existing ? existing.packageId : getDefaultUnit(product).id);
    setKeypadValue(existing ? String(existing.qty) : "");
  };

  const keypadPress = (key: string) => {
    if (key === "backspace") {
      setKeypadValue((v) => v.slice(0, -1));
    } else if (key === ".") {
      if (!keypadValue.includes(".")) setKeypadValue((v) => v + ".");
    } else {
      setKeypadValue((v) => (v === "0" && key !== "." ? key : v + key));
    }
  };

  // Pushes a single item save to the server with conflict-aware semantics.
  // On 409, surfaces a modal so the user can choose to overwrite the other
  // counter's value. Returns true on success / queued-for-conflict, false
  // on hard error (network, validation).
  const saveItemToServer = useCallback(
    async (productId: string, packageId: string | null, qty: number | null, opts?: { force?: boolean }) => {
      if (!user) return false;
      const key = serverItemKey(productId, packageId);
      const existing = serverItemsRef.current[key];
      // Conflict expectation: tell the server "I last saw this counted by X
      // (or nobody)". If the server's current row was counted by someone
      // else since, it returns 409. Skip the guard on a forced overwrite.
      const expectedPriorCountedById = opts?.force
        ? undefined
        : (existing?.countedById ?? null);

      try {
        const res = await fetch("/api/stock-checks/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frequency: frequency.toUpperCase(),
            ...(expiredActionRef.current ? { expiredAction: expiredActionRef.current } : {}),
            items: [
              {
                productId,
                productPackageId: packageId,
                countedQty: qty,
                ...(opts?.force ? {} : { expectedPriorCountedById }),
              },
            ],
          }),
        });
        if (res.status === 409) {
          const body = await res.json();
          // Soft block: the open count is more than a day old. Prompt for the
          // choice, then the retry carries expiredAction and goes through.
          if (body.code === "COUNT_EXPIRED") {
            setExpiredCount({
              countId: body.countId,
              daysOpen: body.daysOpen ?? 1,
              countDate: body.countDate ?? null,
            });
            return false;
          }
          const conflict: ConflictItem | undefined = body.conflicts?.[0];
          if (conflict) {
            setConflictPrompt({
              conflict,
              pending: { productId, productPackageId: packageId, countedQty: qty },
            });
          }
          return false;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Save failed");
        }
        const data = await res.json();
        // Hydrate countId (will be the same on subsequent saves) and merge
        // returned items into serverItems for fresh authorship metadata.
        if (data.countId && data.countId !== countId) setCountId(data.countId);
        setServerItems((prev) => {
          const next = { ...prev };
          for (const it of data.items as ServerItem[]) {
            next[serverItemKey(it.productId, it.productPackageId)] = it;
          }
          return next;
        });
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
        return false;
      }
    },
    [user, frequency, countId],
  );

  const keypadConfirm = async () => {
    if (!keypadItem) return;
    const qty = parseFloat(keypadValue);
    if (isNaN(qty) || qty < 0) return;
    // Optimistic local update — server sync happens in parallel so the
    // UI stays snappy. If the server rejects with a conflict, the modal
    // will surface and the user can re-tap with "Overwrite".
    setCounts((prev) => ({
      ...prev,
      [keypadItem.id]: { qty, packageId: keypadPkgId },
    }));
    const productId = keypadItem.id;
    const packageId = keypadPkgId;
    setKeypadItem(null);
    void saveItemToServer(productId, packageId, qty);
  };

  // Per-item Clear: sets countedQty=null server-side so polling/realtime
  // don't re-hydrate the value within 3 seconds. Optimistic local clear
  // first for snappy UI.
  const keypadClear = () => {
    if (!keypadItem) return;
    const productId = keypadItem.id;
    const packageId = keypadPkgId;
    setCounts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setKeypadItem(null);
    if (countId) void saveItemToServer(productId, packageId, null);
  };

  // ── Finalize ──
  // Two-phase model now: per-item upserts happened during counting (via
  // saveItemToServer), so this just flips the DRAFT count to SUBMITTED and
  // triggers the stock balance commit. The "Submit" button is named
  // "Finalize" in the UI — anyone at the outlet can tap once 235/235 is
  // reached, even if they didn't start the count.
  const handleSubmit = async (opts?: { staleReason?: string; scheduleReason?: string }) => {
    if (submitting) return;
    if (!user?.outletId) {
      const msg = "No outlet assigned to your account.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!countId) {
      const msg = "No active count to finalize. Tap an item first.";
      setError(msg);
      toast.error(msg);
      return;
    }
    // A count can trip more than one soft block (expired AND off-schedule), and
    // the prompts are answered one at a time. Accumulate the answers so the
    // retry carries every reason given so far — sending only the newest would
    // bounce off the guard already satisfied, and the two prompts would loop.
    const reasons = { ...answeredReasonsRef.current, ...opts };
    answeredReasonsRef.current = reasons;

    setSubmitting(true);
    setError(null);
    const pendingToastId = toast.loading("Finalizing stock count…");
    try {
      const res = await fetch(`/api/stock-checks/${countId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reasons),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        // Soft block: the count expired before it was finalized. Ask when the
        // stock was actually counted, then resend — the count is filed under
        // the day it closes, with the answer recorded on it.
        if (errBody?.code === "COUNT_EXPIRED") {
          setStalePrompt({ daysOpen: errBody.daysOpen ?? 1, reason: "" });
          toast.dismiss(pendingToastId);
          return;
        }
        // Soft block: a census being closed outside its window. Ask why, then
        // resend — the count is accepted with the reason recorded, and goes to
        // a manager rather than auto-approving.
        if (errBody?.code === "OFF_SCHEDULE") {
          setSchedulePrompt({
            expectedLabel: errBody.expectedLabel ?? "its scheduled day",
            actualLabel: errBody.actualLabel ?? "today",
            reason: "",
          });
          toast.dismiss(pendingToastId);
          return;
        }
        throw new Error(errBody?.error || "Finalize failed");
      }
      answeredReasonsRef.current = {};
      setStalePrompt(null);
      setSchedulePrompt(null);
      setSubmitted(true);
      setCounts({});
      setCountId(null);
      setServerItems({});
      setExpiredCount(null);
      setExpiredAction(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* iOS private mode */ }
      toast.success(`Stock count finalized (${countedItems} items)`, { id: pendingToastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Finalize failed";
      setError(msg);
      toast.error(msg, { id: pendingToastId });
    } finally {
      setSubmitting(false);
    }
  };

  const switchFrequency = (f: "daily" | "weekly" | "monthly") => {
    setFrequency(f);
    setCounts(loadDraft(f));
    setCollapsedAreas(new Set());
    setSubmitted(false);
  };

  // Reset = nuke local + server. Without the DELETE call, the 3-second
  // polling would re-hydrate the cleared local state from the still-alive
  // DRAFT count and the reset would silently undo itself.
  const resetCheck = async () => {
    if (countId) {
      const toastId = toast.loading("Resetting count…");
      try {
        const res = await fetch(`/api/stock-checks/${countId}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Reset failed");
        }
        toast.success("Count reset", { id: toastId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reset failed", { id: toastId });
        return;
      }
    }
    setCounts({});
    setSubmitted(false);
    setLastSaved(null);
    setCountId(null);
    setServerItems({});
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  const filteredData = groupedData
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.sku.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((group) => group.items.length > 0);

  // Loading
  if (loading) {
    return (
      <>
        <TopBar title="Stock count" />
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand-text" />
          <p className="mt-3 text-sm text-text-3">Loading products...</p>
        </div>
      </>
    );
  }

  if (error && products.length === 0) {
    return (
      <>
        <TopBar title="Stock count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <p className="text-sm font-medium text-danger-text">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  // Success
  if (submitted) {
    return (
      <>
        <TopBar title="Stock count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-soft">
            <Check className="h-8 w-8 text-ok-text" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text">Stock count finalised</h2>
          <p className="mt-1 text-sm text-text-3">Your count has been recorded.</p>
          <Button
            className="mt-6 bg-ink hover:bg-ink-hover"
            onClick={() => {
              setSubmitted(false);
              setStartNewOverride((v) => !v); // toggle to retrigger fetchActive
            }}
          >
            Start a new count
          </Button>
        </div>
      </>
    );
  }

  // "Today's count is done" — read-only view shown when a SUBMITTED count
  // exists for this outlet+frequency and the user hasn't tapped "Start new
  // count" yet. Mirrors the design decision: don't block re-counts, but
  // make people explicitly opt in.
  if (submittedToday && !startNewOverride) {
    const finalizedTime = submittedToday.finalizedAt || submittedToday.submittedAt;
    const finalizerName = submittedToday.finalizedBy?.name || submittedToday.countedBy?.name || "Someone";
    return (
      <>
        <TopBar title="Stock count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-soft">
            <Check className="h-8 w-8 text-ok-text" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text">Today&apos;s {frequency} count is done</h2>
          <p className="mt-1 text-sm text-text-3 text-center">
            Finalized by {finalizerName}
            {finalizedTime && <> at {formatTime(finalizedTime)}</>}
          </p>
          <Button
            className="mt-6 bg-ink hover:bg-ink-hover"
            onClick={() => setStartNewOverride(true)}
          >
            Start a new count
          </Button>
          <p className="mt-3 text-xs text-text-3 text-center max-w-xs">
            Only start a new count if you need to re-count after a delivery or adjustment.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Stock count" />

      {/* Frequency tabs + progress */}
      <div className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="px-4 pt-3 pb-2">
          <div className="mx-auto flex max-w-lg items-center gap-1">
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <button
                key={f}
                onClick={() => switchFrequency(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  frequency === f
                    ? "bg-ink text-on-ink"
                    : "bg-sunken text-text-3 hover:bg-line"
                }`}
              >
                {f}
              </button>
            ))}
            {countedItems > 0 && (
              <button
                onClick={resetCheck}
                className="ml-auto flex items-center gap-1 text-xs text-text-3 hover:text-text-2"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>

          {/* Progress */}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-text-3">
              <span className="font-semibold text-text">{countedItems}/{totalItems}</span> counted
              {lastSaved && <span className="ml-2 text-ok">· saved {lastSaved}</span>}
            </span>
            <Badge
              variant={countedItems === totalItems ? "default" : "secondary"}
              className={countedItems === totalItems ? "bg-ok" : ""}
            >
              {progressPct}%
            </Badge>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-ink transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>

          {/* Collaborators strip — shows other people counting alongside you.
              Renders only when there's at least one server-stamped item, so
              first-tapping the page doesn't show a stale "0 contributors". */}
          {contributors.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <Users className="h-3 w-3 shrink-0 text-text-3" />
              {contributors.map((c) => (
                <span
                  key={c.id}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    c.id === user?.id
                      ? "bg-brand-soft text-brand-text"
                      : "bg-info-soft text-info-text"
                  }`}
                  title={`${c.itemCount} item${c.itemCount === 1 ? "" : "s"}`}
                >
                  {c.id === user?.id ? "You" : c.name} · {c.itemCount}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="sticky top-[105px] z-30 border-b border-line bg-surface px-4 py-2">
        <div className="mx-auto max-w-lg">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              placeholder="Search product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3">
          <div className="mx-auto max-w-lg rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-text">{error}</div>
        </div>
      )}

      {/* Off-schedule notice — shown before any counting starts, so nobody
          walks the whole store and only then learns the census wasn't due
          today. Informational, not a block: the block (with a reason prompt)
          happens at finalize. */}
      {schedule?.offSchedule && (
        <div className="mx-4 mt-3">
          <div className="mx-auto flex max-w-lg items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn-text">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              The {frequency} count is due <span className="font-medium">{schedule.expectedLabel}</span>.
              Today is {schedule.actualLabel} — you can still count, but you&apos;ll be asked why.
            </span>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="px-4 py-3 pb-28">
        <div className="mx-auto max-w-lg space-y-3">
          {filteredData.length === 0 && (
            <p className="py-8 text-center text-sm text-text-3">
              {search ? "No products match your search." : "No products found."}
            </p>
          )}
          {filteredData.map((group) => {
            const isCollapsed = collapsedAreas.has(group.area);
            const groupTotal = group.items.length;
            const groupCounted = group.items.filter((i) => counts[i.id] != null).length;
            const allCounted = groupCounted === groupTotal;

            return (
              <div key={group.area}>
                <div className="flex items-center justify-between py-1.5">
                  <button
                    onClick={() => setCollapsedAreas((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.area)) next.delete(group.area);
                      else next.add(group.area);
                      return next;
                    })}
                    className="flex items-center gap-2"
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-text-3" />
                      : <ChevronDown className="h-4 w-4 text-text-3" />}
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-3">
                      {displayLabel(group.area)}
                    </span>
                    <span className={`text-xs ${allCounted ? "text-ok" : "text-text-3"}`}>
                      {groupCounted}/{groupTotal}
                    </span>
                  </button>
                  {allCounted && <Check className="h-4 w-4 text-ok" />}
                </div>

                {!isCollapsed && (
                  <div className="space-y-1.5">
                    {group.items.map((item) => {
                      const count = counts[item.id];
                      const isCounted = count != null;
                      const uom = getUomLabel(item, count?.packageId);
                      // Per-item authorship — only set once the save has
                      // landed on the server (collaborative model). Items
                      // counted locally but not yet synced won't show this
                      // until /items returns.
                      const serverIt = serverItems[serverItemKey(item.id, count?.packageId ?? null)];
                      const countedByOther =
                        serverIt?.countedBy && serverIt.countedBy.id !== user?.id;

                      return (
                        <Card
                          key={item.id}
                          className={`overflow-hidden transition-all active:scale-[0.98] ${isCounted ? "border-ok/30 bg-ok-soft/30" : "bg-surface"}`}
                          onClick={() => openKeypad(item)}
                        >
                          <div className="flex items-center gap-3 px-3 py-3 cursor-pointer">
                            {/* Count badge */}
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                                isCounted
                                  ? "bg-ok-soft text-ok-text"
                                  : "bg-sunken text-text-3"
                              }`}
                            >
                              {isCounted ? count.qty : "—"}
                            </div>

                            {/* Product info — NO balance shown (blind count) */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-text">{item.name}</p>
                              <p className="flex items-center gap-1.5 text-xs text-text-3">
                                <span>{uom}</span>
                                {countedByOther && serverIt?.countedAt && (
                                  <span className="rounded bg-info-soft px-1.5 py-px text-[10px] font-medium text-info-text">
                                    {serverIt.countedBy!.name} {formatTime(serverIt.countedAt)}
                                  </span>
                                )}
                              </p>
                            </div>

                            {isCounted && (
                              <Check className="h-4 w-4 shrink-0 text-ok" />
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom submit bar — taller Finalize button for an obvious primary
          action at the bottom of long count lists. */}
      <div className="fixed bottom-14 left-0 right-0 z-40 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            className="flex-1 h-14 bg-ink hover:bg-ink-hover text-base font-semibold"
            disabled={countedItems < totalItems || submitting}
            onClick={() => handleSubmit()}
          >
            {submitting ? (
              <><Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> Finalizing...</>
            ) : (
              `Finalize Count (${countedItems}/${totalItems})`
            )}
          </Button>
        </div>
      </div>

      {/* ── Expired-count modal (soft block) ── the open count is more than a
          day old, so it can no longer be a single-date snapshot. Counting on
          into it would file today's shelves under the day it was opened, which
          is what silently corrupted past shrinkage figures. Two honest ways
          out; no way to carry on pretending it's the same date. */}
      {expiredCount && !expiredAction && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft">
                <AlertTriangle className="h-5 w-5 text-warn-text" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-text">
                  This count expired
                </h3>
                <p className="mt-1 text-sm text-text-3">
                  It was started {expiredCount.daysOpen === 1 ? "a day" : `${expiredCount.daysOpen} days`} ago
                  {expiredCount.countDate && (
                    <> and is dated {new Date(expiredCount.countDate).toLocaleDateString()}</>
                  )}
                  . Stock has moved since. Counting more into it would record today&apos;s stock under that
                  older date.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              <Button
                className="h-12 bg-ink hover:bg-ink-hover"
                onClick={() => {
                  // Leave the old draft alone and count today from scratch.
                  setExpiredAction("new");
                  setExpiredCount(null);
                  setCounts({});
                  setCountId(null);
                  setServerItems({});
                  try { localStorage.removeItem(STORAGE_KEY); } catch { /* iOS private mode */ }
                }}
              >
                Start a new count for today
              </Button>
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  // Keep the lines already counted; the count gets re-dated to
                  // today server-side on the next save.
                  setExpiredAction("continue");
                  setExpiredCount(null);
                  toast("Count re-dated to today — carry on where you left off.");
                }}
              >
                Continue it (re-date to today)
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-text-3">
              Nothing already counted is deleted either way.
            </p>
          </div>
        </div>
      )}

      {/* ── Stale-finalize modal ── an expired count can still be closed, but
          only once someone records when the stock was actually counted. The
          count is then filed under the day it closes, with that answer on it. */}
      {stalePrompt && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft">
                <AlertTriangle className="h-5 w-5 text-warn-text" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-text">
                  Open {stalePrompt.daysOpen === 1 ? "a day" : `${stalePrompt.daysOpen} days`} — when was this counted?
                </h3>
                <p className="mt-1 text-sm text-text-3">
                  A manager will review it. Say which day(s) the stock was physically counted so the
                  numbers can be read correctly.
                </p>
              </div>
            </div>
            <Input
              className="mt-4"
              autoFocus
              placeholder="e.g. counted Tue morning, finished Wed"
              value={stalePrompt.reason}
              onChange={(e) => setStalePrompt({ ...stalePrompt, reason: e.target.value })}
            />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setStalePrompt(null)}>
                Cancel
              </Button>
              <Button
                className="bg-ink hover:bg-ink-hover"
                disabled={stalePrompt.reason.trim().length < 3 || submitting}
                onClick={() => void handleSubmit({ staleReason: stalePrompt.reason.trim() })}
              >
                Finalize
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Off-schedule modal ── a census outside its window is allowed, but
          only on the record. The reason is stamped on the count and a manager
          reviews it instead of it auto-approving. */}
      {schedulePrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft">
                <AlertTriangle className="h-5 w-5 text-warn-text" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-text">
                  This {frequency} count isn&apos;t due today
                </h3>
                <p className="mt-1 text-sm text-text-3">
                  It&apos;s due {schedulePrompt.expectedLabel}, and today is {schedulePrompt.actualLabel}.
                  Say why you&apos;re counting now and a manager will review it.
                </p>
              </div>
            </div>
            <Input
              className="mt-4"
              autoFocus
              placeholder="e.g. audit tomorrow, counting early"
              value={schedulePrompt.reason}
              onChange={(e) => setSchedulePrompt({ ...schedulePrompt, reason: e.target.value })}
            />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setSchedulePrompt(null)}>
                Cancel
              </Button>
              <Button
                className="bg-ink hover:bg-ink-hover"
                disabled={schedulePrompt.reason.trim().length < 3 || submitting}
                onClick={() => void handleSubmit({ scheduleReason: schedulePrompt.reason.trim() })}
              >
                Finalize
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict modal ── shown when another counter already saved this
          item with a different value. User picks: overwrite or keep theirs. */}
      {conflictPrompt && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft">
                <AlertTriangle className="h-5 w-5 text-warn-text" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-text">
                  {conflictPrompt.conflict.countedByName ?? "Someone"} already counted this
                </h3>
                <p className="mt-1 text-sm text-text-3">
                  They saved <span className="font-medium text-text">{conflictPrompt.conflict.countedQty ?? "—"}</span>.
                  You&apos;re about to overwrite with <span className="font-medium text-text">{conflictPrompt.pending.countedQty}</span>.
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  // Keep theirs — revert the optimistic local update.
                  setCounts((prev) => {
                    const next = { ...prev };
                    const serverQty = conflictPrompt.conflict.countedQty;
                    if (serverQty != null) {
                      next[conflictPrompt.pending.productId] = {
                        qty: serverQty,
                        packageId: conflictPrompt.pending.productPackageId,
                      };
                    } else {
                      delete next[conflictPrompt.pending.productId];
                    }
                    return next;
                  });
                  setConflictPrompt(null);
                }}
              >
                Keep theirs
              </Button>
              <Button
                className="bg-ink hover:bg-ink-hover"
                onClick={async () => {
                  const { productId, productPackageId, countedQty } = conflictPrompt.pending;
                  setConflictPrompt(null);
                  await saveItemToServer(productId, productPackageId, countedQty, { force: true });
                }}
              >
                Overwrite
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Keypad overlay ── */}
      {keypadItem && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-surface">
          {/* Header */}
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-text">{keypadItem.name}</h3>
                <p className="text-xs text-text-3">{keypadItem.sku}</p>
              </div>
              <button
                onClick={() => setKeypadItem(null)}
                className="ml-3 rounded-lg p-2 text-text-3 hover:bg-sunken"
              >
                <span className="text-sm font-medium">Cancel</span>
              </button>
            </div>

            {/* Unit selector — taller pills + bigger text so it's obvious
                this is tappable. Critical control for unit-confusion: staff
                should never miss that a smaller unit exists. Whenever any
                package multiplies (cf ≠ 1) a "Loose <base>" option is offered
                too — bread only had a ×10 pack line, staff keyed pieces into
                it, and every bread count came out 10× inflated. */}
            {keypadItem.packages.some((p) => p.conversion !== 1) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {[{ id: null as string | null, label: `Loose ${keypadItem.baseUom}` },
                  ...keypadItem.packages.map((pkg) => ({ id: pkg.id as string | null, label: pkg.label || pkg.name })),
                ].map((opt) => (
                  <button
                    key={opt.id ?? "loose-base"}
                    onClick={() => setKeypadPkgId(opt.id)}
                    className={`shrink-0 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-colors active:scale-95 ${
                      keypadPkgId === opt.id
                        ? "border-ink bg-brand-soft text-brand-text"
                        : "border-line bg-surface text-text-2 hover:border-line-2"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Display */}
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="text-center">
              <p className={`text-6xl font-bold tabular-nums ${keypadValue ? "text-text" : "text-line-ctl"}`}>
                {keypadValue || "0"}
              </p>
              <p className="mt-2 text-sm text-text-3">
                {getUomLabel(keypadItem, keypadPkgId)}
              </p>
              {/* Conversion preview — shows the typed value translated into
                  base units so the counter sees what's actually being stored.
                  Helps catch unit confusion like "31 cartons" vs "31 bottles"
                  before saving. Hidden when typed value is 0/empty or when the
                  package conversion factor is 1 (no multiplication anyway). */}
              {(() => {
                const typed = parseFloat(keypadValue);
                if (!keypadValue || isNaN(typed) || typed <= 0) return null;
                // null = loose base units, factor 1 — no preview needed.
                const pkg = keypadPkgId
                  ? keypadItem.packages.find((p) => p.id === keypadPkgId)
                  : null;
                const cf = pkg?.conversion || 1;
                if (cf <= 1) return null;
                const total = typed * cf;
                return (
                  <p className="mt-3 text-sm font-medium text-warn-text">
                    = <span className="font-bold">{total.toLocaleString()}</span> {keypadItem.baseUom}
                    <span className="ml-1 font-normal text-warn/80">({typed} × {cf.toLocaleString()})</span>
                  </p>
                );
              })()}
            </div>
          </div>

          {/* Keypad grid — large tap targets so staff can count single-handed
              without misclicks. h-18 = 4.5rem, well above the 44px iOS
              accessibility minimum. */}
          <div className="border-t border-line bg-sunken/60 px-4 pb-24 pt-3">
            <div className="mx-auto grid max-w-sm grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map((key) => (
                <button
                  key={key}
                  onClick={() => keypadPress(key)}
                  className={`flex h-[4.5rem] items-center justify-center rounded-2xl text-2xl font-semibold transition-colors active:scale-95 ${
                    key === "backspace"
                      ? "bg-line text-text-2 active:bg-line-2"
                      : "bg-surface text-text shadow-sm active:bg-sunken"
                  }`}
                >
                  {key === "backspace" ? <Delete className="h-6 w-6" /> : key}
                </button>
              ))}
            </div>

            {/* Action buttons — match keypad scale so the Save target is
                obvious and easy to hit single-handed. */}
            <div className="mx-auto mt-3 flex max-w-sm gap-2.5">
              {counts[keypadItem.id] != null && (
                <Button
                  variant="outline"
                  className="flex-1 h-14 text-base text-danger border-danger/30 hover:bg-danger-soft"
                  onClick={keypadClear}
                >
                  Clear
                </Button>
              )}
              <Button
                className="flex-1 h-14 bg-ink hover:bg-ink-hover text-lg font-semibold"
                onClick={keypadConfirm}
                disabled={!keypadValue && !counts[keypadItem.id]}
              >
                {keypadValue ? "Save" : "Skip"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

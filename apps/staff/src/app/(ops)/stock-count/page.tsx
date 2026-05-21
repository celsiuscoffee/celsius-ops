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
// expectedPriorCountedById guard.
interface PendingSave {
  productId: string;
  productPackageId: string | null;
  countedQty: number;
}

const STORAGE_KEY = "celsius-stock-check-draft-v2";

function loadDraft(freq: string): Record<string, ItemCount> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data.frequency !== freq) return {};
    const today = new Date().toISOString().split("T")[0];
    if (data.date !== today) { localStorage.removeItem(STORAGE_KEY); return {}; }
    return data.items || {};
  } catch { return {}; }
}

function saveDraft(freq: string, items: Record<string, ItemCount>) {
  try {
    const today = new Date().toISOString().split("T")[0];
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
      setLastSaved(new Date().toLocaleTimeString());
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
        } | null;
        submittedToday: typeof submittedToday;
      } = await res.json();

      if (data.active) {
        setCountId(data.active.id);
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
  // NOTE: as of 2026-05-20, postgres_changes events aren't being delivered
  // to the anon client in this Supabase project (not specific to our tables
  // — even tables that worked previously now don't). Realtime stays wired
  // as the fast-path for when the project-level config gets sorted; the
  // 3-second polling fallback below guarantees updates regardless.
  useEffect(() => {
    if (!countId) return;
    const channel = supabase
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
    return () => {
      supabase.removeChannel(channel);
    };
  }, [countId, fetchActive]);

  // ── Polling fallback ──
  // Refetches the active count every 3 seconds while there's a DRAFT in
  // progress. Cheap (small JSON payload, ~5–10 KB for 235 items) and
  // unconditional — works regardless of realtime config. Pauses when the
  // tab is hidden (PWA backgrounded) to save battery + cellular data.
  useEffect(() => {
    if (!countId) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      fetchActive();
    };
    const interval = window.setInterval(tick, 3000);
    const onVisibility = () => { if (!document.hidden) fetchActive(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [countId, fetchActive]);

  // Group + filter by frequency
  const groupedData: GroupedArea[] = useMemo(() => {
    const freqKey = frequency.toUpperCase();
    const filtered = freqKey === "DAILY"
      ? products.filter((p) => p.checkFrequency === "DAILY")
      : freqKey === "WEEKLY"
        ? products.filter((p) => p.checkFrequency === "DAILY" || p.checkFrequency === "WEEKLY")
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

  const getUomLabel = useCallback((product: Product, packageId?: string | null) => {
    if (packageId) {
      const pkg = product.packages.find((p) => p.id === packageId);
      if (pkg) return pkg.label || pkg.name;
    }
    const pkg = getDefaultPkg(product);
    return pkg ? (pkg.label || pkg.name) : product.baseUom;
  }, [getDefaultPkg]);

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
    const defaultPkg = getDefaultPkg(product);
    setKeypadItem(product);
    setKeypadPkgId(existing?.packageId || defaultPkg?.id || null);
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
    async (productId: string, packageId: string | null, qty: number, opts?: { force?: boolean }) => {
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

  const keypadClear = () => {
    if (!keypadItem) return;
    setCounts((prev) => {
      const next = { ...prev };
      delete next[keypadItem.id];
      return next;
    });
    setKeypadItem(null);
  };

  // ── Finalize ──
  // Two-phase model now: per-item upserts happened during counting (via
  // saveItemToServer), so this just flips the DRAFT count to SUBMITTED and
  // triggers the stock balance commit. The "Submit" button is named
  // "Finalize" in the UI — anyone at the outlet can tap once 235/235 is
  // reached, even if they didn't start the count.
  const handleSubmit = async () => {
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
    setSubmitting(true);
    setError(null);
    const pendingToastId = toast.loading("Finalizing stock count…");
    try {
      const res = await fetch(`/api/stock-checks/${countId}/finalize`, {
        method: "POST",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || "Finalize failed");
      }
      setSubmitted(true);
      setCounts({});
      setCountId(null);
      setServerItems({});
      localStorage.removeItem(STORAGE_KEY);
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

  const resetCheck = () => {
    setCounts({});
    setSubmitted(false);
    setLastSaved(null);
    localStorage.removeItem(STORAGE_KEY);
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
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-terracotta" />
          <p className="mt-3 text-sm text-gray-500">Loading products...</p>
        </div>
      </>
    );
  }

  if (error && products.length === 0) {
    return (
      <>
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <p className="text-sm font-medium text-red-600">{error}</p>
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
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Stock Count Finalized</h2>
          <p className="mt-1 text-sm text-gray-500">Your count has been recorded.</p>
          <Button
            className="mt-6 bg-terracotta hover:bg-terracotta-dark"
            onClick={() => {
              setSubmitted(false);
              setStartNewOverride((v) => !v); // toggle to retrigger fetchActive
            }}
          >
            Start New Count
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
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Today&apos;s {frequency} count is done</h2>
          <p className="mt-1 text-sm text-gray-500 text-center">
            Finalized by {finalizerName}
            {finalizedTime && <> at {new Date(finalizedTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>}
          </p>
          <Button
            className="mt-6 bg-terracotta hover:bg-terracotta-dark"
            onClick={() => setStartNewOverride(true)}
          >
            Start New Count
          </Button>
          <p className="mt-3 text-xs text-gray-400 text-center max-w-xs">
            Only start a new count if you need to re-count after a delivery or adjustment.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Stock Count" />

      {/* Frequency tabs + progress */}
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="px-4 pt-3 pb-2">
          <div className="mx-auto flex max-w-lg items-center gap-1">
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <button
                key={f}
                onClick={() => switchFrequency(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  frequency === f
                    ? "bg-terracotta text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {f}
              </button>
            ))}
            {countedItems > 0 && (
              <button
                onClick={resetCheck}
                className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>

          {/* Progress */}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              <span className="font-semibold text-gray-900">{countedItems}/{totalItems}</span> counted
              {lastSaved && <span className="ml-2 text-green-500">· saved {lastSaved}</span>}
            </span>
            <Badge
              variant={countedItems === totalItems ? "default" : "secondary"}
              className={countedItems === totalItems ? "bg-green-500" : ""}
            >
              {progressPct}%
            </Badge>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-terracotta transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>

          {/* Collaborators strip — shows other people counting alongside you.
              Renders only when there's at least one server-stamped item, so
              first-tapping the page doesn't show a stale "0 contributors". */}
          {contributors.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <Users className="h-3 w-3 shrink-0 text-gray-400" />
              {contributors.map((c) => (
                <span
                  key={c.id}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    c.id === user?.id
                      ? "bg-terracotta/10 text-terracotta-dark"
                      : "bg-blue-50 text-blue-700"
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
      <div className="sticky top-[105px] z-30 border-b border-gray-100 bg-white px-4 py-2">
        <div className="mx-auto max-w-lg">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
          <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* Items */}
      <div className="px-4 py-3 pb-28">
        <div className="mx-auto max-w-lg space-y-3">
          {filteredData.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
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
                      ? <ChevronRight className="h-4 w-4 text-gray-400" />
                      : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {displayLabel(group.area)}
                    </span>
                    <span className={`text-xs ${allCounted ? "text-green-500" : "text-gray-400"}`}>
                      {groupCounted}/{groupTotal}
                    </span>
                  </button>
                  {allCounted && <Check className="h-4 w-4 text-green-500" />}
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
                          className={`overflow-hidden transition-all active:scale-[0.98] ${isCounted ? "border-green-200 bg-green-50/30" : "bg-white"}`}
                          onClick={() => openKeypad(item)}
                        >
                          <div className="flex items-center gap-3 px-3 py-3 cursor-pointer">
                            {/* Count badge */}
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                                isCounted
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-400"
                              }`}
                            >
                              {isCounted ? count.qty : "—"}
                            </div>

                            {/* Product info — NO balance shown (blind count) */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
                              <p className="flex items-center gap-1.5 text-xs text-gray-400">
                                <span>{uom}</span>
                                {countedByOther && serverIt?.countedAt && (
                                  <span className="rounded bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-700">
                                    {serverIt.countedBy!.name} {new Date(serverIt.countedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                              </p>
                            </div>

                            {isCounted && (
                              <Check className="h-4 w-4 shrink-0 text-green-500" />
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
      <div className="fixed bottom-14 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            className="flex-1 h-14 bg-terracotta hover:bg-terracotta-dark text-base font-semibold"
            disabled={countedItems < totalItems || submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <><Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> Finalizing...</>
            ) : (
              `Finalize Count (${countedItems}/${totalItems})`
            )}
          </Button>
        </div>
      </div>

      {/* ── Conflict modal ── shown when another counter already saved this
          item with a different value. User picks: overwrite or keep theirs. */}
      {conflictPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900">
                  {conflictPrompt.conflict.countedByName ?? "Someone"} already counted this
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  They saved <span className="font-medium text-gray-900">{conflictPrompt.conflict.countedQty ?? "—"}</span>.
                  You&apos;re about to overwrite with <span className="font-medium text-gray-900">{conflictPrompt.pending.countedQty}</span>.
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
                className="bg-terracotta hover:bg-terracotta-dark"
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
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          {/* Header */}
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-gray-900">{keypadItem.name}</h3>
                <p className="text-xs text-gray-400">{keypadItem.sku}</p>
              </div>
              <button
                onClick={() => setKeypadItem(null)}
                className="ml-3 rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <span className="text-sm font-medium">Cancel</span>
              </button>
            </div>

            {/* Package selector */}
            {keypadItem.packages.length > 1 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto">
                {keypadItem.packages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => setKeypadPkgId(pkg.id)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      keypadPkgId === pkg.id
                        ? "border-terracotta bg-terracotta/10 text-terracotta"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    {pkg.label || pkg.name}
                  </button>
                ))}
              </div>
            )}
            {keypadItem.packages.length === 1 && (
              <p className="mt-1 text-xs text-gray-500">
                Count in: <span className="font-medium text-gray-700">{keypadItem.packages[0].label || keypadItem.packages[0].name}</span>
              </p>
            )}
          </div>

          {/* Display */}
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="text-center">
              <p className={`text-6xl font-bold tabular-nums ${keypadValue ? "text-gray-900" : "text-gray-300"}`}>
                {keypadValue || "0"}
              </p>
              <p className="mt-2 text-sm text-gray-400">
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
                const pkg = keypadPkgId
                  ? keypadItem.packages.find((p) => p.id === keypadPkgId)
                  : getDefaultPkg(keypadItem);
                const cf = pkg?.conversion || 1;
                if (cf <= 1) return null;
                const total = typed * cf;
                return (
                  <p className="mt-3 text-xs text-amber-700">
                    = <span className="font-semibold">{total.toLocaleString()}</span> {keypadItem.baseUom}
                    <span className="ml-1 text-amber-500/70">({typed} × {cf.toLocaleString()})</span>
                  </p>
                );
              })()}
            </div>
          </div>

          {/* Keypad grid — large tap targets so staff can count single-handed
              without misclicks. h-18 = 4.5rem, well above the 44px iOS
              accessibility minimum. */}
          <div className="border-t border-gray-200 bg-gray-50 px-4 pb-24 pt-3">
            <div className="mx-auto grid max-w-sm grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map((key) => (
                <button
                  key={key}
                  onClick={() => keypadPress(key)}
                  className={`flex h-[4.5rem] items-center justify-center rounded-2xl text-2xl font-semibold transition-colors active:scale-95 ${
                    key === "backspace"
                      ? "bg-gray-200 text-gray-600 active:bg-gray-300"
                      : "bg-white text-gray-900 shadow-sm active:bg-gray-100"
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
                  className="flex-1 h-14 text-base text-red-500 border-red-200 hover:bg-red-50"
                  onClick={keypadClear}
                >
                  Clear
                </Button>
              )}
              <Button
                className="flex-1 h-14 bg-terracotta hover:bg-terracotta-dark text-lg font-semibold"
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

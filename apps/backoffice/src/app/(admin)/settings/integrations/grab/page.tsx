"use client";

/**
 * GrabFood integration admin page.
 *
 * Surfaces everything staff need to manage the GrabFood integration without
 * touching env vars: linkage state per outlet, configuration mode, recent
 * order activity, and quick links to the Grab developer portal + our own
 * health endpoints. Edits flow through /api/integrations/grab.
 *
 * The OAuth credentials, HMAC, and Partner client ID/secret live in Vercel
 * env vars (on the celsius-pos project). They're managed via the deploy
 * pipeline, not from this UI — see scripts/grab-go-live.sh for cutover.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Link2,
  ExternalLink,
  Save,
  Store,
  Activity,
  Rocket,
} from "lucide-react";

type Outlet = {
  id: string;
  name: string;
  city: string | null;
  storehubId: string | null;
  grabMerchantId: string | null;
  isActive: boolean;
  // Grab integration status, pushed by Grab to /api/pos/grab/status during/after
  // self-serve activation: ACTIVE / SYNCING / FAILED / INACTIVE (null = never linked).
  integrationStatus: string | null;
  integrationStatusAt: string | null;
};

type RecentOrder = {
  id: string;
  externalId: string | null;
  orderNumber: string | null;
  outletName: string | null;
  status: string | null;
  totalRM: number | null;
  createdAt: string;
};

type Status = {
  configured: boolean;
  env: string;
  outlets: Outlet[];
  recentOrders: RecentOrder[];
  stats: { last7d: number; last30d: number; allTime: number };
};

// Grab API endpoints used to live on the (retiring) Capacitor web POS
// at celsius-pos.vercel.app. After migration they're under
// /api/pos/grab/* on this same backoffice deployment, so the links
// here are now relative paths.

export default function GrabIntegrationPage() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // Self-serve activation: per-outlet generating flag, resulting URL, error, copy state.
  const [ssBusy, setSsBusy] = useState<Record<string, boolean>>({});
  const [ssUrl, setSsUrl] = useState<Record<string, string>>({});
  const [ssErr, setSsErr] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // Manual "push latest menu to Grab": per-outlet busy flag + last result message.
  const [syncBusy, setSyncBusy] = useState<Record<string, boolean>>({});
  const [syncMsg, setSyncMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  // "Sync all menus" — push every connected outlet's menu to Grab in one click.
  const [syncAllBusy, setSyncAllBusy] = useState(false);
  const [syncAllMsg, setSyncAllMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/grab", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Status;
      setData(json);
      setEdits({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveOutlet = async (outletId: string) => {
    const next = (edits[outletId] ?? "").trim();
    setSaving((s) => ({ ...s, [outletId]: true }));
    try {
      const res = await fetch("/api/integrations/grab", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, grabMerchantId: next || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving((s) => ({ ...s, [outletId]: false }));
    }
  };

  // Generate a Grab self-serve activation link for an outlet. We send the outlet
  // id as the Partner store ID (matches the order webhook's resolution).
  const generateSelfServe = async (outletId: string) => {
    setSsBusy((s) => ({ ...s, [outletId]: true }));
    setSsErr((s) => ({ ...s, [outletId]: "" }));
    try {
      const res = await fetch("/api/pos/grab/self-serve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantID: outletId }),
      });
      const json = await res.json();
      const url = json.activationUrl || json.activation_url;
      if (!res.ok || !url) {
        throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
      }
      setSsUrl((s) => ({ ...s, [outletId]: url }));
    } catch (e) {
      setSsErr((s) => ({ ...s, [outletId]: e instanceof Error ? e.message : "Failed to generate link" }));
    } finally {
      setSsBusy((s) => ({ ...s, [outletId]: false }));
    }
  };

  const copyUrl = async (outletId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(outletId);
      setTimeout(() => setCopied((c) => (c === outletId ? null : c)), 1500);
    } catch {
      /* clipboard blocked — the URL is still visible to copy manually */
    }
  };

  // Push the latest backoffice menu to Grab for a linked outlet. The endpoint
  // builds that outlet's menu (live 86 list + service hours) and PUTs it straight
  // to GrabFood. Backoffice stays the source of truth — this makes GrabFood match
  // it on demand instead of waiting on Grab.
  const syncMenu = async (outletId: string, merchantID: string) => {
    setSyncBusy((s) => ({ ...s, [outletId]: true }));
    setSyncMsg((s) => ({ ...s, [outletId]: { ok: true, text: "" } }));
    try {
      const res = await fetch("/api/pos/grab/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantID }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
      }
      setSyncMsg((s) => ({
        ...s,
        [outletId]: { ok: true, text: "Menu pushed to GrabFood — the storefront will reflect it shortly." },
      }));
    } catch (e) {
      setSyncMsg((s) => ({
        ...s,
        [outletId]: { ok: false, text: e instanceof Error ? e.message : "Sync failed" },
      }));
    } finally {
      setSyncBusy((s) => ({ ...s, [outletId]: false }));
    }
  };

  // Push the latest menu to every connected outlet at once (mirrors StoreHub's
  // top-bar "Sync Menu"). Fans out to the same per-outlet endpoint so each store
  // gets its own menu pushed (live 86 list + hours).
  const syncAllMenus = async () => {
    const linked = (data?.outlets ?? []).filter((o) => o.grabMerchantId);
    if (linked.length === 0) return;
    setSyncAllBusy(true);
    setSyncAllMsg(null);
    const results = await Promise.allSettled(
      linked.map((o) =>
        fetch("/api/pos/grab/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantID: o.grabMerchantId }),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    setSyncAllMsg({
      ok: failed === 0,
      text:
        failed === 0
          ? `Pushed menu to all ${ok} connected outlet${ok === 1 ? "" : "s"} — GrabFood will reflect it shortly.`
          : `${ok} synced, ${failed} failed. Use the per-outlet button below to retry the failures.`,
    });
    setSyncAllBusy(false);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error || "Failed to load GrabFood status"}
      </div>
    );
  }

  const linkedCount = data.outlets.filter((o) => !!o.grabMerchantId).length;
  const isProd = data.env === "production";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">GrabFood Integration</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Outlet linkage, sync activity, and operational status for the GrabFood Partner API integration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {linkedCount > 0 ? (
            <button
              onClick={syncAllMenus}
              disabled={syncAllBusy}
              title="Push the latest backoffice menu to every connected outlet"
              className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncAllBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync all menus
            </button>
          ) : null}
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {syncAllMsg ? (
        <div
          className={`rounded border p-3 text-sm ${
            syncAllMsg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {syncAllMsg.text}
        </div>
      ) : null}

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Status cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          icon={data.configured ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          label="Configuration"
          value={data.configured ? "Linked" : "Not linked"}
          sub={data.configured ? `${linkedCount}/${data.outlets.length} outlets linked` : "Set a merchant ID below"}
        />
        <StatusCard
          icon={<Activity className="h-5 w-5 text-blue-600" />}
          label="Environment"
          value={isProd ? "Production" : "Sandbox"}
          sub={isProd ? "Live customer orders" : "Test orders only (App Simulator)"}
          tone={isProd ? "prod" : "stage"}
        />
        <StatusCard
          icon={<Store className="h-5 w-5 text-violet-600" />}
          label="GrabFood orders"
          value={`${data.stats.last7d} (7d)`}
          sub={`${data.stats.last30d} last 30d · ${data.stats.allTime} all time`}
        />
      </div>

      {/* Outlet linkage */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-base font-medium text-neutral-900">Outlet ↔ Grab merchant linkage</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Each Grab merchant ID maps to one outlet. Incoming Grab orders use this to route to the right POS / KDS.
            Find your IDs in the GrabFood Developer Portal → Store Information.
          </p>
        </header>
        <div className="divide-y divide-neutral-100">
          {data.outlets.map((o) => {
            const current = o.grabMerchantId ?? "";
            const edit = edits[o.id] ?? current;
            const dirty = edit !== current;
            return (
              <div key={o.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                    {o.name}
                    {!o.isActive ? (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">Inactive</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {o.city || "—"} · storehubId: <code>{o.storehubId || "—"}</code>
                  </div>
                </div>
                <input
                  className="w-64 rounded border border-neutral-300 px-2 py-1 font-mono text-sm focus:border-neutral-500 focus:outline-none"
                  placeholder="e.g. GFSBPOS-083-564"
                  value={edit}
                  onChange={(e) => setEdits((s) => ({ ...s, [o.id]: e.target.value }))}
                />
                <button
                  onClick={() => saveOutlet(o.id)}
                  disabled={!dirty || saving[o.id]}
                  className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-2.5 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving[o.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Self-serve store activation */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-base font-medium text-neutral-900">Self-serve store activation</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Generate a Grab activation link per outlet. The store owner opens it to link their existing
            GrabFood store to this POS integration — Grab then pushes the store menu and integration status
            to us automatically (no manual merchant-ID entry). The outlet id is sent as the Partner store ID.
          </p>
        </header>
        <div className="divide-y divide-neutral-100">
          {data.outlets.map((o) => {
            const url = ssUrl[o.id];
            const err = ssErr[o.id];
            const sync = syncMsg[o.id];
            return (
              <div key={o.id} className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                      {o.name}
                      <ConnectionBadge status={o.integrationStatus} at={o.integrationStatusAt} />
                    </div>
                    <div className="text-xs text-neutral-500">
                      Partner store ID: <code>{o.id}</code>
                    </div>
                  </div>
                  {o.grabMerchantId ? (
                    <button
                      onClick={() => syncMenu(o.id, o.grabMerchantId!)}
                      disabled={syncBusy[o.id]}
                      title="Push the latest backoffice menu to Grab for this outlet"
                      className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {syncBusy[o.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Sync menu
                    </button>
                  ) : null}
                  <button
                    onClick={() => generateSelfServe(o.id)}
                    disabled={ssBusy[o.id]}
                    className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-2.5 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ssBusy[o.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                    {url ? "Regenerate link" : "Generate activation link"}
                  </button>
                </div>
                {url ? (
                  <div className="mt-2 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-emerald-900">{url}</code>
                    <button
                      onClick={() => copyUrl(o.id, url)}
                      className="shrink-0 rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      {copied === o.id ? "Copied!" : "Copy"}
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : null}
                {err ? <div className="mt-2 text-xs text-red-600">{err}</div> : null}
                {sync && sync.text ? (
                  <div className={`mt-2 text-xs ${sync.ok ? "text-emerald-700" : "text-red-600"}`}>{sync.text}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent orders */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-base font-medium text-neutral-900">Recent GrabFood orders (last 14 days)</h2>
        </header>
        {data.recentOrders.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-neutral-500">
            No GrabFood orders yet. Place a test order via the App Simulator to see one here.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-2">Order #</th>
                <th className="px-5 py-2">Outlet</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2 text-right">Total</th>
                <th className="px-5 py-2 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.recentOrders.map((o) => (
                <tr key={o.id} className="text-neutral-800">
                  <td className="px-5 py-2 font-mono text-xs">{o.orderNumber || o.externalId || o.id.slice(0, 8)}</td>
                  <td className="px-5 py-2">{o.outletName || "—"}</td>
                  <td className="px-5 py-2">
                    <StatusPill status={o.status} />
                  </td>
                  <td className="px-5 py-2 text-right font-mono">
                    {o.totalRM != null ? `RM ${o.totalRM.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-5 py-2 text-right text-xs text-neutral-500">
                    {new Date(o.createdAt).toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Quick links */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-2 text-base font-medium text-neutral-900">Quick links</h2>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <ExternalLinkRow
            href="https://developer.grab.com/dashboard/grab-platform/"
            label="Grab Developer Portal"
            sub="Projects, OAuth clients, HMAC secret, App Simulator, Menu Validation."
          />
          <ExternalLinkRow
            href="/api/pos/grab/health"
            label="POS Grab health endpoint"
            sub="Confirms our server can fetch a Grab OAuth token (staff-auth required)."
          />
          <ExternalLinkRow
            href="/api/pos/grab/merchant/menu"
            label="POS Get-menu webhook"
            sub="The endpoint Grab calls to fetch our menu (requires partner Bearer token)."
          />
          <ExternalLinkRow
            href="https://developer.grab.com/docs/grabfood/api/v1-1-3"
            label="GrabFood Partner API docs"
            sub="API reference and integration guide."
          />
        </div>
      </section>

      {/* Operational notes */}
      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-700">
        <h2 className="mb-2 text-base font-medium text-neutral-900">How this fits together</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>OAuth, HMAC, and Partner client credentials live as Vercel env vars on the <code>celsius-backoffice</code> project (not editable here). The legacy <code>celsius-pos</code> project is no longer the source of truth.</li>
          <li>To rotate or swap to production, run <code>scripts/grab-go-live.sh</code> from the repo root.</li>
          <li>To run the full integration test suite, run <code>scripts/grab-e2e.sh</code> after every deploy.</li>
          <li>Inbound Grab endpoints (configure these in the Grab Partner Portal): <code>/api/pos/grab/oauth/token</code> (OAuth), <code>/api/pos/grab/webhook</code> (orders + state push), <code>/api/pos/grab/merchant/menu</code> (get menu), <code>/api/pos/grab/menus</code>, <code>/api/pos/grab/status</code>, <code>/api/pos/grab/menu-sync</code>. All under <code>https://backoffice.celsiuscoffee.com</code>.</li>
        </ul>
      </section>
    </div>
  );
}

/* ─── components ─── */

function StatusCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "prod" | "stage";
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-2">
        {props.icon}
        <span className="text-xs uppercase tracking-wide text-neutral-500">{props.label}</span>
      </div>
      <div
        className={`mt-1 text-xl font-semibold ${
          props.tone === "prod" ? "text-emerald-700" : props.tone === "stage" ? "text-amber-700" : "text-neutral-900"
        }`}
      >
        {props.value}
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">{props.sub}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const s = (status || "").toLowerCase();
  const cls =
    s === "completed" || s === "delivered"
      ? "bg-emerald-100 text-emerald-700"
      : s === "cancelled" || s === "failed"
      ? "bg-red-100 text-red-700"
      : s === "open" || s === "pending"
      ? "bg-amber-100 text-amber-700"
      : "bg-neutral-100 text-neutral-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {status || "—"}
    </span>
  );
}

// Grab integration connection state per outlet, from Grab's /status webhook
// pushes (ACTIVE / SYNCING / FAILED / INACTIVE; null = never linked).
function ConnectionBadge({ status, at }: { status: string | null; at: string | null }) {
  const s = (status || "").toUpperCase();
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: "● Connected", cls: "bg-emerald-100 text-emerald-700" },
    SYNCING: { label: "● Syncing", cls: "bg-blue-100 text-blue-700" },
    FAILED: { label: "● Failed", cls: "bg-red-100 text-red-700" },
    INACTIVE: { label: "● Inactive", cls: "bg-neutral-100 text-neutral-600" },
  };
  const m = map[s] ?? { label: "○ Not linked", cls: "bg-neutral-100 text-neutral-500" };
  const title = at
    ? `Grab reported "${s}" at ${new Date(at).toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" })}`
    : "No integration status received from Grab yet";
  return (
    <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

function ExternalLinkRow({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-2 rounded border border-neutral-200 p-3 hover:border-neutral-400 hover:bg-neutral-50"
    >
      <Link2 className="mt-0.5 h-4 w-4 text-neutral-400 group-hover:text-neutral-600" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium text-neutral-900">
          {label}
          <ExternalLink className="h-3 w-3 text-neutral-400" />
        </div>
        <div className="text-xs text-neutral-500">{sub}</div>
      </div>
    </a>
  );
}

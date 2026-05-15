"use client";

import { useState, useEffect } from "react";
import {
  Target, Plus, Pencil, Trash2, X, Sun, RefreshCw, MapPin, Users, Clock,
  Coffee, Sparkles, Croissant,
} from "lucide-react";

type Difficulty = "easy" | "medium" | "hard";

interface Mission {
  id: string;
  brand_id: string;
  title: string;
  description: string;
  icon: string;
  difficulty: Difficulty;
  goal: { type: string; threshold: number; filter?: Record<string, unknown> };
  reward_voucher_template_ids: string[];
  // Only set for referrals_count missions — the voucher templates
  // issued to the REFEREE on their first paid order. reward_voucher_
  // template_ids drives the referrer side.
  referee_reward_voucher_template_ids?: string[];
  reward_bonus_beans: number;
  cooldown_weeks: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  total_picked: number;
  total_completed: number;
  created_at: string;
}

interface VoucherTemplate { id: string; title: string; icon: string; category: string }

const BRAND_ID = "brand-celsius";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  sun: Sun, refresh: RefreshCw, pin: MapPin, users: Users, clock: Clock,
  coffee: Coffee, sparkle: Sparkles, croissant: Croissant, target: Target,
};

const GOAL_TYPES = [
  { value: "orders_count",            label: "Orders this week" },
  { value: "single_order_item_count", label: "Items in single order" },
  { value: "distinct_outlets",        label: "Distinct outlets visited" },
  { value: "distinct_new_products",   label: "New products tried" },
  { value: "spend_amount",            label: "Spend amount (RM)" },
  { value: "referrals_count",         label: "Referrals (config — per-referral payout)" },
];

const DIFF_STYLES: Record<Difficulty, string> = {
  easy:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/10  text-amber-400  border-amber-500/20",
  hard:   "bg-rose-500/10   text-rose-400   border-rose-500/20",
};

export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Mission | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [mRes, tRes] = await Promise.all([
        fetch(`/api/loyalty/missions?brand_id=${BRAND_ID}`, { credentials: "include" }),
        fetch(`/api/loyalty/voucher-templates?brand_id=${BRAND_ID}`, { credentials: "include" }),
      ]);
      const m = await mRes.json();
      const t = await tRes.json();
      setMissions(Array.isArray(m) ? m : []);
      setTemplates(Array.isArray(t) ? t : []);
    } catch {
      setMissions([]); setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(m: Mission) {
    await fetch(`/api/loyalty/missions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: m.id, is_active: !m.is_active }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this mission?")) return;
    await fetch(`/api/loyalty/missions?id=${id}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Target className="w-6 h-6" />
            Mission Pool
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Weekly challenges customers can pick. Customers see active missions in the app each Monday,
            choose one, and earn vouchers on completion. Mix difficulty for broad appeal.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Mission
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : missions.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {missions.map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              templates={templates}
              onEdit={() => setEditing(m)}
              onToggle={() => toggleActive(m)}
              onDelete={() => remove(m.id)}
            />
          ))}
        </div>
      )}

      {(editing || creating) && (
        <MissionModal
          mission={editing}
          templates={templates}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

function MissionCard({
  mission, templates, onEdit, onToggle, onDelete,
}: {
  mission: Mission;
  templates: VoucherTemplate[];
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const Icon = ICON_MAP[mission.icon] ?? Sparkles;
  const grantedTemplates = templates.filter((t) => mission.reward_voucher_template_ids.includes(t.id));
  const pickRate = mission.total_picked > 0 ? (mission.total_completed / mission.total_picked) * 100 : 0;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-foreground/5 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold truncate">{mission.title}</h3>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${DIFF_STYLES[mission.difficulty]}`}>
              {mission.difficulty}
            </span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{mission.description}</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
        <div className="flex justify-between">
          <span>Goal</span>
          <span className="text-foreground font-medium">{mission.goal.type} · {mission.goal.threshold}</span>
        </div>
        <div className="flex justify-between">
          <span>Cooldown</span>
          <span className="text-foreground">{mission.cooldown_weeks} weeks</span>
        </div>
        {grantedTemplates.length > 0 && (
          <div className="flex justify-between">
            <span>Vouchers</span>
            <span className="text-foreground text-right">{grantedTemplates.map((t) => t.title).join(" + ")}</span>
          </div>
        )}
        {mission.reward_bonus_beans > 0 && (
          <div className="flex justify-between">
            <span>Bonus Beans</span>
            <span className="text-foreground">+{mission.reward_bonus_beans}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs border-t pt-3">
        <div>
          <div className="font-semibold text-base">{mission.total_picked}</div>
          <div className="text-muted-foreground">Picked</div>
        </div>
        <div>
          <div className="font-semibold text-base">{mission.total_completed}</div>
          <div className="text-muted-foreground">Completed</div>
        </div>
        <div>
          <div className="font-semibold text-base">{pickRate.toFixed(0)}%</div>
          <div className="text-muted-foreground">Rate</div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onToggle}
          className={`text-xs font-medium px-2.5 py-1 rounded ${
            mission.is_active
              ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {mission.is_active ? "● Active" : "○ Paused"}
        </button>
        <div className="flex gap-1">
          <button onClick={onEdit} className="p-1.5 hover:bg-muted rounded" aria-label="Edit">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="p-1.5 hover:bg-rose-500/10 text-rose-500 rounded" aria-label="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────

function MissionModal({
  mission, templates, onClose, onSaved,
}: {
  mission: Mission | null;
  templates: VoucherTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(mission?.title ?? "");
  const [description, setDescription] = useState(mission?.description ?? "");
  const [icon, setIcon] = useState(mission?.icon ?? "sparkle");
  const [difficulty, setDifficulty] = useState<Difficulty>(mission?.difficulty ?? "easy");
  const [goalType, setGoalType] = useState(mission?.goal?.type ?? "orders_count");
  const [goalThreshold, setGoalThreshold] = useState(mission?.goal?.threshold ?? 5);
  const [filterHourLt, setFilterHourLt] = useState<number | "">(
    (mission?.goal?.filter as { order_hour_lt?: number })?.order_hour_lt ?? ""
  );
  const [voucherIds, setVoucherIds] = useState<string[]>(mission?.reward_voucher_template_ids ?? []);
  const [refereeVoucherIds, setRefereeVoucherIds] = useState<string[]>(
    mission?.referee_reward_voucher_template_ids ?? [],
  );
  const [bonusBeans, setBonusBeans] = useState(mission?.reward_bonus_beans ?? 0);
  const [cooldownWeeks, setCooldownWeeks] = useState(mission?.cooldown_weeks ?? 4);
  const [isActive, setIsActive] = useState(mission?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const goal: Mission["goal"] = { type: goalType, threshold: goalThreshold };
      if (filterHourLt !== "") goal.filter = { order_hour_lt: Number(filterHourLt) };

      const payload = {
        brand_id: BRAND_ID,
        title, description, icon, difficulty, goal,
        reward_voucher_template_ids: voucherIds,
        referee_reward_voucher_template_ids:
          goalType === "referrals_count" ? refereeVoucherIds : [],
        reward_bonus_beans: bonusBeans,
        cooldown_weeks: cooldownWeeks,
        is_active: isActive,
      };

      const res = mission
        ? await fetch(`/api/loyalty/missions`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: mission.id, ...payload }),
          })
        : await fetch(`/api/loyalty/missions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Save failed");
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  function toggleVoucher(id: string) {
    setVoucherIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl w-full max-w-xl md:max-w-3xl my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">{mission ? "Edit Mission" : "New Mission"}</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Early Bird" />
          </Field>

          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Order before 10am, 5 mornings this week" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Icon">
              <select value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">
                {Object.keys(ICON_MAP).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Difficulty">
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className="w-full border rounded-lg px-3 py-2 bg-background">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </Field>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-foreground/[0.02]">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completion Goal</div>
            <Field label="Goal type">
              <select value={goalType} onChange={(e) => setGoalType(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">
                {GOAL_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Threshold">
                <input type="number" min={1} value={goalThreshold} onChange={(e) => setGoalThreshold(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
              </Field>
              <Field label="Order before hour (optional)">
                <input type="number" min={0} max={23} value={filterHourLt} onChange={(e) => setFilterHourLt(e.target.value === "" ? "" : Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="e.g. 10" />
              </Field>
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-foreground/[0.02]">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {goalType === "referrals_count" ? "Referrer Reward (per successful referral)" : "Reward on Completion"}
            </div>
            <Field label="Vouchers granted">
              {templates.length === 0 ? (
                <div className="text-xs text-muted-foreground">No voucher templates yet. Create some in Voucher Library first.</div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {templates.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                      <input type="checkbox" checked={voucherIds.includes(t.id)} onChange={() => toggleVoucher(t.id)} />
                      <span className="text-sm">{t.title}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{t.category}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Bonus Beans (added to balance on completion)">
              <input type="number" min={0} value={bonusBeans} onChange={(e) => setBonusBeans(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
          </div>

          {goalType === "referrals_count" && (
            <div className="border rounded-lg p-3 space-y-3 bg-foreground/[0.02]">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Referee Reward (issued on new signup's first paid order)
              </div>
              <Field label="Vouchers granted to referee">
                {templates.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No voucher templates yet. Create some in Voucher Library first.</div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {templates.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={refereeVoucherIds.includes(t.id)}
                          onChange={() =>
                            setRefereeVoucherIds((prev) =>
                              prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                            )
                          }
                        />
                        <span className="text-sm">{t.title}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{t.category}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Field>
              <div className="text-xs text-muted-foreground">
                Referrals are paid per-successful-attribution. The referrer gets the vouchers from the
                section above; the referee gets the vouchers here. Both fire when the referee's first
                paid order lands. This mission is NOT shown to customers as a weekly challenge — it's
                config for the referral mechanic.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cooldown (weeks before re-offering)">
              <input type="number" min={0} value={cooldownWeeks} onChange={(e) => setCooldownWeeks(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
            <Field label="Status">
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active (in pool)</span>
              </label>
            </Field>
          </div>

          {error && <div className="text-sm text-rose-500">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-muted text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : mission ? "Save changes" : "Create mission"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-16 border-2 border-dashed rounded-xl">
      <Target className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-medium mb-1">No missions yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
        Create the first mission to start showing weekly challenges in the customer app.
      </p>
      <button onClick={onCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium">
        <Plus className="w-4 h-4" /> Create first mission
      </button>
    </div>
  );
}

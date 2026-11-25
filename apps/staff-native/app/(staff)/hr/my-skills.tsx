import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { useStaff } from "../../../lib/store";
import {
  fetchMySkills,
  fetchMySkillsCoach,
  type SkillsAuditEntry,
  type SkillsAuditItem,
  type SkillsCoachInsights,
  type SkillsResponse,
} from "../../../lib/hr/api";
import { useCelsius } from "../../../lib/celsius-ui";

export default function MySkills() {
  const C = useCelsius().color;
  const session = useStaff((s) => s.session);
  const userId = session?.userId;
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [coach, setCoach] = useState<SkillsCoachInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [d, c] = await Promise.all([
        fetchMySkills(userId).catch(
          () => ({ auditee: null, templates: [] }) as SkillsResponse,
        ),
        fetchMySkillsCoach(userId)
          .then((r) => r.insights)
          .catch(() => null),
      ]);
      setData(d);
      setCoach(c);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const templates = data?.templates ?? [];

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="My skills" back />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={C["text-3"]} />
        </View>
      ) : templates.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="h-20 w-20 items-center justify-center rounded-2xl bg-sunken">
            <Target color={C["text-2"]} size={32} />
          </View>
          <Text className="mt-4 text-base font-display text-text">
            No skill audits yet
          </Text>
          <Text className="mt-1 text-sm font-body text-text-2 text-center">
            Once a manager audits you, your scores will show up here.
          </Text>
        </View>
      ) : (
    <ScrollView
      className="flex-1"
      contentContainerClassName="pt-2 pb-6 gap-3"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={C["text-3"]}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {coach && !coach.needs_more_data ? (
        <View className="rounded-2xl border border-line-2 bg-sunken p-4">
          <View className="flex-row items-center gap-1.5">
            <View className="h-6 w-6 items-center justify-center rounded-full bg-sunken">
              <Sparkles color={C["text-2"]} size={12} />
            </View>
            <Text className="text-base font-body-semi text-text">
              Coach insights
            </Text>
          </View>
          <Text className="mt-2 text-sm font-body text-text">
            {coach.summary}
          </Text>
          {coach.strengths.length > 0 ? (
            <View className="mt-3">
              <Text className="text-xs font-body-bold text-ok-text">
                Doing well
              </Text>
              {coach.strengths.map((s, i) => (
                <Text key={i} className="text-xs font-body text-text">
                  • {s}
                </Text>
              ))}
            </View>
          ) : null}
          {coach.focus_areas.length > 0 ? (
            <View className="mt-3">
              <Text className="text-xs font-body-bold text-danger-text">
                Focus on
              </Text>
              {coach.focus_areas.map((s, i) => (
                <Text key={i} className="text-xs font-body text-text">
                  • {s}
                </Text>
              ))}
            </View>
          ) : null}
          {coach.coaching_actions.length > 0 ? (
            <View className="mt-3">
              <Text className="text-xs font-body-bold text-text">
                This week
              </Text>
              {coach.coaching_actions.map((s, i) => (
                <Text key={i} className="text-xs font-body text-text">
                  • {s}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {templates.map(({ template, audits }) => {
        const latest = audits[audits.length - 1];
        const first = audits[0];
        const overall =
          latest?.overallScore !== null &&
          first?.overallScore !== null &&
          first !== latest
            ? Math.round(
                (latest!.overallScore! - first!.overallScore!) * 100,
              ) / 100
            : null;
        return (
          <View
            key={template.id}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="text-base font-body-semi text-text">
                  {template.name}
                </Text>
                <Text className="text-xs font-body text-text-3">
                  {audits.length} audit{audits.length !== 1 ? "s" : ""}
                  {template.jobRoleFilter.length > 0
                    ? ` · ${template.jobRoleFilter.join(", ")}`
                    : ""}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-2xl font-display text-text">
                  {latest?.overallScore ?? 0}
                  <Text className="text-base text-text-3">%</Text>
                </Text>
                {overall !== null && audits.length > 1 ? (
                  <DeltaBadge delta={overall} />
                ) : null}
              </View>
            </View>
            <View className="mt-3 border-t border-line pt-2 gap-1">
              {[...audits]
                .reverse()
                .slice(0, 4)
                .map((a, idx) => (
                  <AuditRow key={a.id} audit={a} defaultOpen={idx === 0} />
                ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
      )}
    </Screen>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const C = useCelsius().color;
  if (delta === 0)
    return <Text className="text-xs font-body text-text-3">0%</Text>;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const cls = delta > 0 ? "text-ok-text" : "text-danger-text";
  return (
    <View className="flex-row items-center gap-1">
      <Icon color={delta > 0 ? C["ok-text"] : C.danger} size={10} />
      <Text className={`text-xs font-body-bold ${cls}`}>
        {delta > 0 ? "+" : ""}
        {delta}%
      </Text>
    </View>
  );
}

// One audit in the history: a tappable summary (date, auditor, overall score)
// that expands to show exactly WHAT was assessed, grouped by section, with the
// per-item rating and the auditor's note. Latest audit opens by default so the
// detail is visible without a tap.
function AuditRow({
  audit,
  defaultOpen,
}: {
  audit: SkillsAuditEntry;
  defaultOpen: boolean;
}) {
  const C = useCelsius().color;
  const [open, setOpen] = useState(defaultOpen);
  const tone = scoreTone(audit.overallScore);
  const hasItems = audit.items.length > 0;

  // Group items by section, preserving the audit's order.
  const sections: { name: string; items: SkillsAuditItem[] }[] = [];
  for (const it of audit.items) {
    const name = it.sectionName || "General";
    let sec = sections.find((s) => s.name === name);
    if (!sec) {
      sec = { name, items: [] };
      sections.push(sec);
    }
    sec.items.push(it);
  }

  return (
    <View>
      <Pressable
        onPress={() => hasItems && setOpen((o) => !o)}
        className="flex-row items-center gap-2 py-1 active:opacity-70"
      >
        <Text className="w-16 text-xs font-body text-text-3">{audit.date}</Text>
        <Text className="flex-1 text-xs font-body text-text-2">
          {audit.auditor?.name ?? "Unknown"}
        </Text>
        <View className={`rounded-full px-2 py-0.5 ${tone.bg}`}>
          <Text className={`text-xs font-body-bold ${tone.text}`}>
            {audit.overallScore ?? 0}%
          </Text>
        </View>
        {hasItems ? (
          open ? (
            <ChevronUp color={C["text-3"]} size={14} />
          ) : (
            <ChevronDown color={C["text-3"]} size={14} />
          )
        ) : (
          <View className="w-3.5" />
        )}
      </Pressable>

      {open && hasItems ? (
        <View className="mb-2 mt-1 gap-3 rounded-2xl bg-sunken p-3">
          {sections.map((sec) => (
            <View key={sec.name} className="gap-1.5">
              <Text className="text-xs font-body-bold text-text-3">
                {sec.name}
              </Text>
              {sec.items.map((it, i) => (
                <ItemRow key={i} item={it} />
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ItemRow({ item }: { item: SkillsAuditItem }) {
  const r = ratingDisplay(item);
  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="flex-1">
        <Text className="text-xs font-body text-text">{item.itemTitle}</Text>
        {item.notes ? (
          <Text className="mt-0.5 text-xs font-body italic text-text-2">
            {item.notes}
          </Text>
        ) : null}
      </View>
      <View className={`rounded-md px-1.5 py-0.5 ${r.bg}`}>
        <Text className={`text-xs font-body-bold ${r.text}`}>{r.label}</Text>
      </View>
    </View>
  );
}

function scoreTone(score: number | null): { bg: string; text: string } {
  const s = score ?? 0;
  if (s >= 80) return { bg: "bg-ok-soft", text: "text-ok-text" };
  if (s >= 60) return { bg: "bg-warn-soft", text: "text-warn-text" };
  return { bg: "bg-danger-soft", text: "text-danger-text" };
}

// Render an item's rating in the vocabulary the auditor entered it in
// (see app/(staff)/audit/[id].tsx): pass_fail -> Pass (1) / Fail (0) / N/A (-1),
// rating_5 -> "n/5", rating_3 -> Good/Fair/Poor. Coloured by how good it is;
// unknown types fall back to the raw number.
function ratingDisplay(item: SkillsAuditItem): {
  label: string;
  bg: string;
  text: string;
} {
  const good = { bg: "bg-ok-soft", text: "text-ok-text" };
  const ok = { bg: "bg-warn-soft", text: "text-warn-text" };
  const bad = { bg: "bg-danger-soft", text: "text-danger-text" };
  const na = { bg: "bg-sunken", text: "text-text-2" };

  if (item.ratingType === "pass_fail") {
    // On the form: 1 = Pass, 0 = Fail, -1 = N/A. Match that exactly — a Fail
    // must never read as "N/A", nor an N/A as "Fail".
    if (item.rating === 1) return { label: "Pass", ...good };
    if (item.rating === 0) return { label: "Fail", ...bad };
    return { label: "N/A", ...na };
  }
  if (item.rating == null) return { label: "N/A", ...na };
  if (item.ratingType === "rating_5") {
    const tone = item.rating >= 4 ? good : item.rating >= 3 ? ok : bad;
    return { label: `${item.rating}/5`, ...tone };
  }
  if (item.ratingType === "rating_3") {
    if (item.rating >= 3) return { label: "Good", ...good };
    if (item.rating === 2) return { label: "Fair", ...ok };
    return { label: "Poor", ...bad };
  }
  return { label: String(item.rating), ...ok };
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";

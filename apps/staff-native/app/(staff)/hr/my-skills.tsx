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
  ChevronRight,
  MessageSquare,
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

export default function MySkills() {
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
    <Screen>
      <PageHeader title="My Skills" back />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      ) : templates.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50">
            <Target color="#A2492C" size={32} />
          </View>
          <Text className="mt-4 text-base font-display text-espresso">
            No skill audits yet
          </Text>
          <Text className="mt-1 text-sm font-body text-muted-fg text-center">
            Once a manager audits you, your scores will show up here.
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="pt-2 pb-24 gap-3"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor="#A2492C"
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {coach && !coach.needs_more_data ? (
            <View className="rounded-3xl border border-primary/30 bg-primary-50/30 p-4">
              <View className="flex-row items-center gap-1.5">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-primary/15">
                  <Sparkles color="#A2492C" size={12} />
                </View>
                <Text className="text-base font-body-semi text-espresso">
                  Coach insights
                </Text>
              </View>
              <Text className="mt-2 text-sm font-body text-espresso">
                {coach.summary}
              </Text>
              {coach.strengths.length > 0 ? (
                <View className="mt-3">
                  <Text className="text-[10px] font-body-bold uppercase tracking-wide text-success">
                    Doing well
                  </Text>
                  {coach.strengths.map((s, i) => (
                    <Text key={i} className="text-xs font-body text-espresso">
                      • {s}
                    </Text>
                  ))}
                </View>
              ) : null}
              {coach.focus_areas.length > 0 ? (
                <View className="mt-3">
                  <Text className="text-[10px] font-body-bold uppercase tracking-wide text-danger">
                    Focus on
                  </Text>
                  {coach.focus_areas.map((s, i) => (
                    <Text key={i} className="text-xs font-body text-espresso">
                      • {s}
                    </Text>
                  ))}
                </View>
              ) : null}
              {coach.coaching_actions.length > 0 ? (
                <View className="mt-3">
                  <Text className="text-[10px] font-body-bold uppercase tracking-wide text-primary">
                    This week
                  </Text>
                  {coach.coaching_actions.map((s, i) => (
                    <Text key={i} className="text-xs font-body text-espresso">
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
                className="rounded-3xl border border-border bg-surface p-4"
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-base font-body-semi text-espresso">
                      {template.name}
                    </Text>
                    <Text className="text-[10px] font-body text-muted">
                      {audits.length} audit{audits.length !== 1 ? "s" : ""}
                      {template.jobRoleFilter.length > 0
                        ? ` · ${template.jobRoleFilter.join(", ")}`
                        : ""}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-2xl font-display text-espresso">
                      {latest?.overallScore ?? 0}
                      <Text className="text-base text-muted">%</Text>
                    </Text>
                    {overall !== null && audits.length > 1 ? (
                      <DeltaBadge delta={overall} />
                    ) : null}
                  </View>
                </View>
                <View className="mt-3 border-t border-border pt-1">
                  {[...audits].reverse().map((a) => (
                    <AuditRow key={a.id} audit={a} />
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

// One audit in a template's history. Collapsed it shows date / auditor /
// score; tapping expands to reveal exactly what was assessed — every item
// grouped by section, its rating, the change vs the previous audit, and any
// note the auditor left. This is the "so they know what was audited" detail
// that the API already returned but the screen never surfaced.
function AuditRow({ audit }: { audit: SkillsAuditEntry }) {
  const [open, setOpen] = useState(false);
  const score = audit.overallScore ?? 0;
  const scoreCls =
    score >= 80 ? "text-success" : score >= 60 ? "text-amber-700" : "text-danger";
  const scoreBg =
    score >= 80 ? "bg-success/10" : score >= 60 ? "bg-amber-100" : "bg-danger/10";
  const sections = groupBySection(audit.items);
  const hasDetail = audit.items.length > 0;

  return (
    <View className="border-b border-border py-2">
      <Pressable
        onPress={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        accessibilityRole="button"
        accessibilityLabel={`Audit on ${audit.date} by ${audit.auditor?.name ?? "Unknown"}, score ${score}%. ${hasDetail ? (open ? "Collapse" : "Expand") + " details" : ""}`}
        hitSlop={4}
        className="flex-row items-center gap-2 active:opacity-70"
      >
        {hasDetail ? (
          open ? (
            <ChevronDown color="#6B6B6B" size={14} />
          ) : (
            <ChevronRight color="#6B6B6B" size={14} />
          )
        ) : (
          <View className="w-3.5" />
        )}
        <Text className="w-16 text-[10px] font-body text-muted">
          {audit.date}
        </Text>
        <Text className="flex-1 text-xs font-body text-muted-fg" numberOfLines={1}>
          {audit.auditor?.name ?? "Unknown"}
        </Text>
        {audit.scoreDelta ? <DeltaBadge delta={audit.scoreDelta} small /> : null}
        <View className={`rounded-full px-2 py-0.5 ${scoreBg}`}>
          <Text className={`text-[10px] font-body-bold ${scoreCls}`}>
            {score}%
          </Text>
        </View>
      </Pressable>

      {open ? (
        <View className="mt-2 ml-5 gap-3">
          {audit.outlet?.name ? (
            <Text className="text-[10px] font-body text-muted">
              Audited at {audit.outlet.name}
            </Text>
          ) : null}
          {sections.map((section) => (
            <View key={section.sectionName}>
              <Text className="text-[10px] font-body-bold uppercase tracking-wide text-muted">
                {section.sectionName}
              </Text>
              <View className="mt-1 gap-1.5">
                {section.items.map((item, i) => (
                  <ItemRow key={`${item.itemTitle}-${i}`} item={item} />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ItemRow({ item }: { item: SkillsAuditItem }) {
  const badge = ratingBadge(item.ratingType, item.rating);
  return (
    <View className="flex-row items-start gap-2">
      <View className="flex-1">
        <Text className="text-xs font-body text-espresso">{item.itemTitle}</Text>
        {item.notes ? (
          <View className="mt-1 flex-row items-start gap-1 rounded-lg bg-blue-50 px-2 py-1">
            <MessageSquare color="#1D4ED8" size={11} style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[11px] font-body text-blue-700">
              {item.notes}
            </Text>
          </View>
        ) : null}
      </View>
      {item.ratingDelta ? <RatingDelta delta={item.ratingDelta} /> : null}
      <View className={`rounded-full px-2 py-0.5 ${badge.bg}`}>
        <Text className={`text-[10px] font-body-bold ${badge.cls}`}>
          {badge.text}
        </Text>
      </View>
    </View>
  );
}

// Map a stored rating to a human label + colour, matching the audit form
// semantics (apps/staff-native/app/(staff)/audit/[id].tsx):
//   pass_fail → 1 Pass / 0 Fail / -1 N-A
//   rating_5  → n / 5 stars, green ≥4, amber 3, red ≤2
//   rating_3  → 3 Good / 2 Fair / 1 Poor
function ratingBadge(
  ratingType: string,
  rating: number | null,
): { text: string; cls: string; bg: string } {
  const na = { text: "N/A", cls: "text-muted", bg: "bg-muted/10" };
  if (rating === null) return na;
  if (ratingType === "pass_fail") {
    if (rating === 1) return { text: "Pass", cls: "text-success", bg: "bg-success/10" };
    if (rating === 0) return { text: "Fail", cls: "text-danger", bg: "bg-danger/10" };
    return na;
  }
  if (ratingType === "rating_5") {
    const cls = rating >= 4 ? "text-success" : rating >= 3 ? "text-amber-700" : "text-danger";
    const bg = rating >= 4 ? "bg-success/10" : rating >= 3 ? "bg-amber-100" : "bg-danger/10";
    return { text: `${rating}/5`, cls, bg };
  }
  if (ratingType === "rating_3") {
    if (rating === 3) return { text: "Good", cls: "text-success", bg: "bg-success/10" };
    if (rating === 2) return { text: "Fair", cls: "text-amber-700", bg: "bg-amber-100" };
    return { text: "Poor", cls: "text-danger", bg: "bg-danger/10" };
  }
  return { text: String(rating), cls: "text-muted-fg", bg: "bg-muted/10" };
}

function groupBySection(
  items: SkillsAuditItem[],
): Array<{ sectionName: string; items: SkillsAuditItem[] }> {
  const map = new Map<string, SkillsAuditItem[]>();
  for (const it of items) {
    const key = it.sectionName || "General";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return Array.from(map, ([sectionName, sectionItems]) => ({
    sectionName,
    items: sectionItems,
  }));
}

// Per-item rating change vs the previous audit (whole-number steps).
function RatingDelta({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <View className="flex-row items-center gap-0.5">
      <Icon color={up ? "#15803D" : "#B91C1C"} size={10} />
      <Text
        className={`text-[10px] font-body-bold ${up ? "text-success" : "text-danger"}`}
      >
        {up ? "+" : ""}
        {delta}
      </Text>
    </View>
  );
}

function DeltaBadge({ delta, small }: { delta: number; small?: boolean }) {
  if (delta === 0)
    return <Text className="text-[10px] font-body text-muted">0%</Text>;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const cls = delta > 0 ? "text-success" : "text-danger";
  const size = small ? 9 : 10;
  return (
    <View className="flex-row items-center gap-1">
      <Icon color={delta > 0 ? "#15803D" : "#B91C1C"} size={size} />
      <Text className={`text-[10px] font-body-bold ${cls}`}>
        {delta > 0 ? "+" : ""}
        {delta}%
      </Text>
    </View>
  );
}

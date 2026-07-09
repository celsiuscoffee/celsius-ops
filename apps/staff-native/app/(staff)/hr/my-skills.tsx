import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Sparkles, Target, TrendingDown, TrendingUp } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { useStaff } from "../../../lib/store";
import {
  fetchMySkills,
  fetchMySkillsCoach,
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
            <View className="mt-3 border-t border-border pt-2 gap-1">
              {[...audits]
                .reverse()
                .slice(0, 4)
                .map((a) => (
                  <View
                    key={a.id}
                    className="flex-row items-center gap-2"
                  >
                    <Text className="w-16 text-[10px] font-body text-muted">
                      {a.date}
                    </Text>
                    <Text className="flex-1 text-xs font-body text-muted-fg">
                      {a.auditor?.name ?? "Unknown"}
                    </Text>
                    <View
                      className={`rounded-full px-2 py-0.5 ${
                        (a.overallScore ?? 0) >= 80
                          ? "bg-success/10"
                          : (a.overallScore ?? 0) >= 60
                            ? "bg-amber-100"
                            : "bg-danger/10"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-body-bold ${
                          (a.overallScore ?? 0) >= 80
                            ? "text-success"
                            : (a.overallScore ?? 0) >= 60
                              ? "text-amber-700"
                              : "text-danger"
                        }`}
                      >
                        {a.overallScore ?? 0}%
                      </Text>
                    </View>
                  </View>
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
  if (delta === 0)
    return <Text className="text-[10px] font-body text-muted">0%</Text>;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const cls = delta > 0 ? "text-success" : "text-danger";
  return (
    <View className="flex-row items-center gap-1">
      <Icon color={delta > 0 ? "#15803D" : "#B91C1C"} size={10} />
      <Text className={`text-[10px] font-body-bold ${cls}`}>
        {delta > 0 ? "+" : ""}
        {delta}%
      </Text>
    </View>
  );
}

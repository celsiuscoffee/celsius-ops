import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  Plus,
  Users,
} from "lucide-react-native";
import {
  fetchAuditCoverage,
  listAudits,
  type AuditCoverageTemplate,
  type AuditListItem,
} from "../../../lib/ops/audits";

export default function AuditList() {
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const [items, setItems] = useState<AuditListItem[]>([]);
  const [coverage, setCoverage] = useState<AuditCoverageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Which template's expanded-auditee list is open, keyed by template id.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Parallel: list of past audits + per-template coverage.
      const [auditList, cov] = await Promise.all([
        listAudits().catch(() => []),
        fetchAuditCoverage().catch(() => ({ templates: [], windowDays: 30 })),
      ]);
      setItems(auditList);
      setCoverage(cov.templates);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const inProgress = items.filter((a) => a.status === "IN_PROGRESS");
  const completed = items.filter((a) => a.status === "COMPLETED");

  if (loading && items.length === 0) {
    return (
      <Screen>
        <PageHeader title="Audits" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Audits" />
      <FlatList
        data={[]}
        keyExtractor={() => ""}
        renderItem={() => null}
        contentContainerClassName="pt-2"
        contentContainerStyle={{ paddingBottom: tabBarHeight + 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
            tintColor="#A2492C"
          />
        }
        ListHeaderComponent={
          <View>
            {/* Coverage cards, one per active STAFF template
                (Barista skills, Kitchen skills, etc.). Shows who's
                NOT been audited in the last 30 days + the average
                score of those who have. Tap any card to expand the
                full auditee list with their individual status. */}
            {coverage.length > 0 ? (
              <View className="mb-4">
                <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                  Staff coverage
                </Text>
                <View className="gap-2">
                  {coverage.map((tmpl) => (
                    <CoverageCard
                      key={tmpl.id}
                      tmpl={tmpl}
                      open={!!expanded[tmpl.id]}
                      onToggle={() =>
                        setExpanded((p) => ({ ...p, [tmpl.id]: !p[tmpl.id] }))
                      }
                      onStartAudit={(auditeeId) =>
                        router.push(
                          `/audit/new?templateId=${tmpl.id}&auditeeId=${auditeeId}`,
                        )
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {inProgress.length > 0 ? (
              <View className="mb-4">
                <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                  In progress
                </Text>
                <View className="gap-2">
                  {inProgress.map((a) => (
                    <AuditCard
                      key={a.id}
                      audit={a}
                      onPress={() => router.push(`/audit/${a.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {completed.length > 0 ? (
              <View>
                <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                  Completed
                </Text>
                <View className="gap-2">
                  {completed.slice(0, 10).map((a) => (
                    <AuditCard
                      key={a.id}
                      audit={a}
                      onPress={() => router.push(`/audit/${a.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {items.length === 0 ? (
              <View className="mt-12 items-center px-6">
                <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50">
                  <ClipboardList color="#A2492C" size={32} />
                </View>
                <Text className="mt-4 text-base font-display text-espresso">
                  No audits yet
                </Text>
                <Text className="mt-1 text-sm font-body text-muted-fg text-center">
                  Tap the button below to start a spot check.
                </Text>
              </View>
            ) : null}
          </View>
        }
      showsVerticalScrollIndicator={false}
    />

      {/* Pinned bottom CTA */}
      <View
        style={{ paddingBottom: tabBarHeight + 12 }}
        className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
      >
        <Pressable
          onPress={() => router.push("/audit/new")}
          className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80"
        >
          <Plus color="#FFFFFF" size={20} />
          <Text className="text-base font-body-bold text-white">
            New audit
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

// Per-template coverage card, surfaces "who's not audited yet"
// and the average score of those who have been. Tap to expand the
// auditee list and start an audit on any specific staff member.
function CoverageCard({
  tmpl,
  open,
  onToggle,
  onStartAudit,
}: {
  tmpl: AuditCoverageTemplate;
  open: boolean;
  onToggle: () => void;
  onStartAudit: (auditeeId: string) => void;
}) {
  const { totals } = tmpl;
  const needsAudit = totals.never + totals.stale;
  const Chevron = open ? ChevronUp : ChevronDown;

  // Sort auditees so pending (never / stale) bubble to the top, then
  // by score asc within recent, lowest performers first so managers
  // see who to coach.
  const sorted = useMemo(() => {
    const order: Record<string, number> = { never: 0, stale: 1, recent: 2 };
    return [...tmpl.auditees].sort((a, b) => {
      const ds = order[a.status] - order[b.status];
      if (ds !== 0) return ds;
      const sa = a.lastAudit?.overallScore ?? 0;
      const sb = b.lastAudit?.overallScore ?? 0;
      return sa - sb;
    });
  }, [tmpl.auditees]);

  return (
    <View className="rounded-2xl border border-border bg-surface">
      <Pressable
        onPress={onToggle}
        className="px-4 py-3 active:bg-primary-50"
      >
        <View className="flex-row items-center gap-3">
          <View
            className={`h-9 w-9 items-center justify-center rounded-xl ${
              needsAudit > 0 ? "bg-amber-500/15" : "bg-success/10"
            }`}
          >
            {needsAudit > 0 ? (
              <AlertTriangle color="#D97706" size={16} />
            ) : (
              <CheckCircle2 color="#15803D" size={16} />
            )}
          </View>
          <View className="flex-1">
            <Text
              className="text-base font-body-medium text-espresso"
              numberOfLines={1}
            >
              {tmpl.name}
            </Text>
            <Text className="mt-0.5 text-[10px] font-body text-muted">
              {totals.eligible} staff · {totals.recent} recently audited
              {totals.avgScore != null
                ? ` · avg ${totals.avgScore}%`
                : ""}
            </Text>
          </View>
          {needsAudit > 0 ? (
            <View className="rounded-full bg-amber-500/15 px-2 py-0.5">
              <Text className="text-[10px] font-body-bold text-amber-700">
                {needsAudit} pending
              </Text>
            </View>
          ) : null}
          <Chevron color="#9CA3AF" size={16} />
        </View>
      </Pressable>

      {open ? (
        <View className="border-t border-border px-4 py-2">
          {sorted.length === 0 ? (
            <Text className="py-3 text-center text-xs text-muted">
              No eligible staff for this template at this outlet.
            </Text>
          ) : (
            sorted.map((a) => <AuditeeRow key={a.userId} a={a} onStart={onStartAudit} />)
          )}
        </View>
      ) : null}
    </View>
  );
}

function AuditeeRow({
  a,
  onStart,
}: {
  a: AuditCoverageTemplate["auditees"][number];
  onStart: (auditeeId: string) => void;
}) {
  const score = a.lastAudit?.overallScore;
  const scoreColor =
    score == null
      ? "text-muted"
      : score >= 80
        ? "text-success"
        : score >= 60
          ? "text-amber-700"
          : "text-danger";
  const statusLabel =
    a.status === "never"
      ? "Never audited"
      : a.status === "stale"
        ? `Audited ${a.lastAudit?.date ?? ""} · stale`
        : `Audited ${a.lastAudit?.date ?? ""}`;
  const statusTone =
    a.status === "never"
      ? "text-danger"
      : a.status === "stale"
        ? "text-amber-700"
        : "text-success";
  return (
    <Pressable
      onPress={() => onStart(a.userId)}
      className="flex-row items-center gap-3 py-2.5 active:bg-primary-50"
    >
      <View className="h-8 w-8 items-center justify-center rounded-full bg-primary-50">
        <Users color="#A2492C" size={14} />
      </View>
      <View className="flex-1">
        <Text
          className="text-base font-body-medium text-espresso"
          numberOfLines={1}
        >
          {a.name}
        </Text>
        <Text className={`text-[10px] font-body ${statusTone}`}>
          {statusLabel}
        </Text>
      </View>
      {score != null ? (
        <Text className={`text-xs font-body-bold ${scoreColor}`}>
          {score}%
        </Text>
      ) : null}
      <ChevronRight color="#D1D5DB" size={14} />
    </Pressable>
  );
}

function AuditCard({
  audit,
  onPress,
}: {
  audit: AuditListItem;
  onPress: () => void;
}) {
  const done = audit.status === "COMPLETED";
  const Icon = done ? CheckCircle2 : Clock;
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl border border-border bg-surface px-3 py-2.5 active:bg-primary-50"
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`h-9 w-9 items-center justify-center rounded-xl ${done ? "bg-success/10" : "bg-blue-100"}`}
        >
          <Icon color={done ? "#15803D" : "#2563EB"} size={16} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="flex-1 text-base font-body-medium text-espresso"
              numberOfLines={1}
            >
              {audit.template.name}
            </Text>
            {audit.isMine ? (
              <View className="rounded-full bg-primary-50 px-1.5 py-px">
                <Text className="text-[9px] font-body-bold text-primary">
                  YOU
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-0.5 text-[10px] font-body text-muted">
            {audit.auditor.name} · {audit.date} · {audit.completedItems}/
            {audit.totalItems}
          </Text>
        </View>
        {done ? (
          <View
            className={`rounded-full px-2 py-0.5 ${
              (audit.overallScore ?? 0) >= 80
                ? "bg-success/10"
                : (audit.overallScore ?? 0) >= 60
                  ? "bg-amber-100"
                  : "bg-danger/10"
            }`}
          >
            <Text
              className={`text-xs font-body-bold ${
                (audit.overallScore ?? 0) >= 80
                  ? "text-success"
                  : (audit.overallScore ?? 0) >= 60
                    ? "text-amber-700"
                    : "text-danger"
              }`}
            >
              {audit.overallScore ?? 0}%
            </Text>
          </View>
        ) : (
          <Text className="text-base font-body-bold text-espresso">
            {audit.progress}%
          </Text>
        )}
        <ChevronRight color="#D1D5DB" size={14} />
      </View>
      {!done ? (
        <View className="mt-2 h-1 overflow-hidden rounded-full bg-primary-50">
          <View
            className="h-full bg-primary"
            style={{ width: `${audit.progress}%` }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

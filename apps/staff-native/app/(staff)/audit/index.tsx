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
import { useCelsius } from "../../../lib/celsius-ui";
import { useStaff } from "../../../lib/store";
import { hasAccess } from "../../../lib/access";

export default function AuditList() {
  const C = useCelsius().color;
  // Audits open from the Checks tab (a row on the checklists screen); only
  // someone with audits but no checklists has this as their tab root.
  const session = useStaff((s) => s.session);
  const fromChecks = hasAccess(session?.role, session?.moduleAccess, "ops:checklists");
  const router = useRouter();
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
      <Screen edges={["top", "left", "right"]}>
        <PageHeader title="Audits" back={fromChecks} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={C["text-3"]} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Audits" back={fromChecks} />
      <FlatList
        data={[]}
        keyExtractor={() => ""}
        renderItem={() => null}
        contentContainerClassName="pt-2 pb-24"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
            tintColor={C["text-3"]}
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
                <Text className="mb-2 text-sm font-body-semi text-text-2">
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
                <Text className="mb-2 text-sm font-body-semi text-text-2">
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
                <Text className="mb-2 text-sm font-body-semi text-text-2">
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
                <View className="h-20 w-20 items-center justify-center rounded-2xl bg-sunken">
                  <ClipboardList color={C["text-2"]} size={32} />
                </View>
                <Text className="mt-4 text-base font-display text-text">
                  No audits yet
                </Text>
                <Text className="mt-1 text-sm font-body text-text-2 text-center">
                  Tap the button below to start a spot check.
                </Text>
              </View>
            ) : null}
          </View>
        }
      showsVerticalScrollIndicator={false}
    />

      {/* Pinned bottom CTA. The tab bar is in-flow (opaque, not absolute), so
          this screen's bottom already ends at the tab bar; a small pb-3 sits it
          just above, no useBottomTabBarHeight padding (that double-counted the
          tab bar and left a big frozen gap). */}
      <View className="absolute inset-x-0 bottom-0 border-t border-line bg-bg px-5 pt-3 pb-3">
        <Pressable
          onPress={() => router.push("/audit/new")}
          className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-ink active:opacity-80"
        >
          <Plus color={C["on-ink"]} size={20} />
          <Text className="text-base font-body-bold text-on-ink">
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
  const C = useCelsius().color;
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
    <View className="rounded-2xl border border-line bg-surface">
      <Pressable
        onPress={onToggle}
        className="px-4 py-3 active:bg-sunken"
      >
        <View className="flex-row items-center gap-3">
          <View
            className={`h-9 w-9 items-center justify-center rounded-xl ${
              needsAudit > 0 ? "bg-warn-soft" : "bg-ok-soft"
            }`}
          >
            {needsAudit > 0 ? (
              <AlertTriangle color={C.warn} size={16} />
            ) : (
              <CheckCircle2 color={C["ok-text"]} size={16} />
            )}
          </View>
          <View className="flex-1">
            <Text
              className="text-base font-body-medium text-text"
              numberOfLines={1}
            >
              {tmpl.name}
            </Text>
            <Text className="mt-0.5 text-xs font-body text-text-3">
              {totals.eligible} staff · {totals.recent} recently audited
              {totals.avgScore != null
                ? ` · avg ${totals.avgScore}%`
                : ""}
            </Text>
          </View>
          {needsAudit > 0 ? (
            <View className="rounded-full bg-warn-soft px-2 py-0.5">
              <Text className="text-xs font-body-bold text-warn-text">
                {needsAudit} pending
              </Text>
            </View>
          ) : null}
          <Chevron color={C["text-3"]} size={16} />
        </View>
      </Pressable>

      {open ? (
        <View className="border-t border-line px-4 py-2">
          {sorted.length === 0 ? (
            <Text className="py-3 text-center text-xs text-text-3">
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
  const C = useCelsius().color;
  const score = a.lastAudit?.overallScore;
  const scoreColor =
    score == null
      ? "text-text-3"
      : score >= 80
        ? "text-ok-text"
        : score >= 60
          ? "text-warn-text"
          : "text-danger-text";
  const statusLabel =
    a.status === "never"
      ? "Never audited"
      : a.status === "stale"
        ? `Audited ${a.lastAudit?.date ?? ""} · stale`
        : `Audited ${a.lastAudit?.date ?? ""}`;
  const statusTone =
    a.status === "never"
      ? "text-danger-text"
      : a.status === "stale"
        ? "text-warn-text"
        : "text-ok-text";
  return (
    <Pressable
      onPress={() => onStart(a.userId)}
      className="flex-row items-center gap-3 py-2.5 active:bg-sunken"
    >
      <View className="h-8 w-8 items-center justify-center rounded-full bg-sunken">
        <Users color={C["text-2"]} size={14} />
      </View>
      <View className="flex-1">
        <Text
          className="text-base font-body-medium text-text"
          numberOfLines={1}
        >
          {a.name}
        </Text>
        <Text className={`text-xs font-body ${statusTone}`}>
          {statusLabel}
        </Text>
      </View>
      {score != null ? (
        <Text className={`text-xs font-body-bold ${scoreColor}`}>
          {score}%
        </Text>
      ) : null}
      <ChevronRight color={C["text-3"]} size={14} />
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
  const C = useCelsius().color;
  const done = audit.status === "COMPLETED";
  const Icon = done ? CheckCircle2 : Clock;
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl border border-line bg-surface px-3 py-2.5 active:bg-sunken"
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`h-9 w-9 items-center justify-center rounded-xl ${done ? "bg-ok-soft" : "bg-info-soft"}`}
        >
          <Icon color={done ? C["ok-text"] : C.info} size={16} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="flex-1 text-base font-body-medium text-text"
              numberOfLines={1}
            >
              {audit.template.name}
            </Text>
            {audit.isMine ? (
              <View className="rounded-full bg-sunken px-1.5 py-px">
                <Text className="text-xs font-body-bold text-text">
                  YOU
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-0.5 text-xs font-body text-text-3">
            {audit.auditor.name} · {audit.date} · {audit.completedItems}/
            {audit.totalItems}
          </Text>
        </View>
        {done ? (
          <View
            className={`rounded-full px-2 py-0.5 ${
              (audit.overallScore ?? 0) >= 80
                ? "bg-ok-soft"
                : (audit.overallScore ?? 0) >= 60
                  ? "bg-warn-soft"
                  : "bg-danger-soft"
            }`}
          >
            <Text
              className={`text-xs font-body-bold ${
                (audit.overallScore ?? 0) >= 80
                  ? "text-ok-text"
                  : (audit.overallScore ?? 0) >= 60
                    ? "text-warn-text"
                    : "text-danger-text"
              }`}
            >
              {audit.overallScore ?? 0}%
            </Text>
          </View>
        ) : (
          <Text className="text-base font-body-bold text-text">
            {audit.progress}%
          </Text>
        )}
        <ChevronRight color={C["text-3"]} size={14} />
      </View>
      {!done ? (
        <View className="mt-2 h-1 overflow-hidden rounded-full bg-sunken">
          <View
            className="h-full bg-ink"
            style={{ width: `${audit.progress}%` }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

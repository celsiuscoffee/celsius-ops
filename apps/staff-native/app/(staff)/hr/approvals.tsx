import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { AlertTriangle, CheckCircle2, ExternalLink, Inbox, XCircle } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { Button, Card, EmptyState, Field, Section, SkeletonList } from "../../../components/ui";
import { ApiError } from "../../../lib/api";
import {
  approvalSections,
  approvalsSummary,
  dayLabel,
  flagsLabel,
  hoursLabel,
  isCleanShift,
  leaveMeta,
  leaveOverBalanceMessage,
  OFFICE_PATHS,
  otApprovedMessage,
  otMeta,
  ptHoursLine,
  ptShiftMeta,
  swapMeta,
  swapTitle,
  type LeaveRequest,
  type OtItem,
  type PtShift,
  type SectionKey,
  type SwapRequest,
} from "../../../lib/hr/approvals";
import {
  approveLeave,
  approveOvertime,
  approveSwap,
  confirmPtShifts,
  officeUrl,
  rejectLeave,
  rejectOvertime,
  rejectSwap,
} from "../../../lib/hr/approvals-api";
import { APPROVALS_KEY, useApprovals } from "../../../lib/hr/use-approvals";
import { useCelsius } from "../../../lib/celsius-ui";

// Approvals (owner, 20 Nov 2026): part-timer hours, overtime, leave and shift
// swaps, decided on the phone during the shift. Only sections with something
// in them show. Each decision is one tap on the SAME back-office endpoint
// Office uses, followed by a message that says what happened, and the list
// refreshes. Anything more involved (editing clock times, partial overtime,
// an overdrawn leave balance) opens in Office.

type Notice = { tone: "ok" | "warn" | "danger"; text: string };

function failure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    if (e.status === 401 || e.status === 403) {
      return e.message && e.message !== "Unauthorized" && e.message !== "Forbidden"
        ? e.message
        : "Office did not let this account do that. Ask an owner if you should be able to.";
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

/** The leave endpoint's 409s that mean "over the balance", not "already decided". */
const overBalance = (body: unknown) => {
  const r = body && typeof body === "object" ? (body as { reason?: unknown }).reason : null;
  return r === "insufficient_balance" || r === "no_balance_row";
};

const openOffice =(key: SectionKey) => void WebBrowser.openBrowserAsync(officeUrl(OFFICE_PATHS[key]));

export default function ApprovalsScreen() {
  const C = useCelsius().color;
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isRefetching, enabled } = useApprovals();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Coming back to the screen reloads; the first focus is the initial load.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current && enabled) refetch();
      focused.current = true;
    }, [enabled, refetch]),
  );

  // Every action: one call, a message either way, then the list reloads.
  const run = async (id: string, act: () => Promise<Notice>) => {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      setNotice(await act());
    } catch (e) {
      setNotice({ tone: "danger", text: failure(e) });
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: APPROVALS_KEY });
    }
  };

  if (!enabled) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <PageHeader title="Approvals" back />
        <EmptyState icon={Inbox} title="Approvals are for managers" subtitle="Leave, overtime, swaps and part-timer hours are decided by your manager." />
      </Screen>
    );
  }

  const sections = data ? approvalSections(data) : [];
  const errors = data?.errors ?? {};
  const errorKeys = Object.keys(errors) as SectionKey[];

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Approvals" subtitle={data ? approvalsSummary(data) : null} back />
      {notice ? <NoticeBar notice={notice} onClose={() => setNotice(null)} /> : null}
      <ScrollView
        contentContainerClassName="pb-10"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={() => refetch()}
            tintColor={C["text-3"]}
            colors={[C["text-2"]]}
          />
        }
      >
        {isLoading ? (
          <View className="mt-2">
            <SkeletonList count={4} />
          </View>
        ) : error ? (
          <Card tone="danger">
            <Text className="text-sm font-body text-danger-text">{failure(error)}</Text>
          </Card>
        ) : data && sections.length === 0 && errorKeys.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting on you"
            subtitle="Part-timer shifts to sign off, overtime, leave and shift swaps show here as they come in."
          />
        ) : null}

        {data
          ? sections.map((s) => (
              <Section
                key={s.key}
                title={`${s.title} · ${s.count}`}
                action={<OfficeLink onPress={() => openOffice(s.key)} />}
              >
                {s.key === "pt" ? <PtSection shifts={data.pt} busy={busy} run={run} /> : null}
                {s.key === "ot" ? <OtSection items={data.ot} busy={busy} run={run} /> : null}
                {s.key === "leave" ? <LeaveSection items={data.leave} busy={busy} run={run} /> : null}
                {s.key === "swap" ? <SwapSection items={data.swaps} busy={busy} run={run} /> : null}
              </Section>
            ))
          : null}

        {errorKeys.map((k) => (
          <Section key={`err-${k}`} title={sectionName(k)} action={<OfficeLink onPress={() => openOffice(k)} />}>
            <Card tone="warn">
              <Text className="text-sm font-body text-warn-text">Could not load this list. {errors[k]}</Text>
            </Card>
          </Section>
        ))}
      </ScrollView>
    </Screen>
  );
}

const sectionName = (k: SectionKey) =>
  ({ pt: "Part-timer hours", ot: "Overtime", leave: "Leave requests", swap: "Shift swaps" })[k];

type RunProps = { busy: string | null; run: (id: string, act: () => Promise<Notice>) => Promise<void> };

/* ---------- Part-timer hours ---------------------------------------------- */

function PtSection({ shifts, busy, run }: RunProps & { shifts: PtShift[] }) {
  const clean = shifts.filter(isCleanShift);
  return (
    <View className="gap-3">
      {clean.length >= 2 ? (
        <Button
          label={`Confirm all ${clean.length} clean shifts`}
          variant="secondary"
          loading={busy === "pt-all"}
          disabled={!!busy && busy !== "pt-all"}
          onPress={() =>
            run("pt-all", async () => {
              const r = await confirmPtShifts(clean.map((s) => s.id));
              return r.skipped > 0
                ? { tone: "warn", text: `Confirmed ${r.confirmed} shifts. ${r.skipped} could not be confirmed here; check them in Office.` }
                : { tone: "ok", text: `Confirmed ${r.confirmed} shifts for weekly pay.` };
            })
          }
        />
      ) : null}
      {shifts.map((s) => {
        const flags = flagsLabel(s.ai_flags);
        return (
          <ItemCard
            key={s.id}
            title={s.name}
            lines={[
              [dayLabel(s.date), s.outlet_name].filter(Boolean).join(" · "),
              ptShiftMeta(s),
              ptHoursLine(s),
            ]}
            warning={s.state === "flagged" ? `Flagged: ${flags || "needs a look"}` : null}
          >
            <Button
              label={s.state === "flagged" ? "Confirm anyway" : "Confirm"}
              size="sm"
              loading={busy === s.id}
              disabled={!!busy && busy !== s.id}
              onPress={() =>
                run(s.id, async () => {
                  const r = await confirmPtShifts([s.id]);
                  return r.confirmed > 0
                    ? { tone: "ok", text: `Confirmed ${s.name}'s shift on ${dayLabel(s.date)}.` }
                    : { tone: "warn", text: `${s.name}'s shift on ${dayLabel(s.date)} was not confirmed. Check it in Office.` };
                })
              }
            />
          </ItemCard>
        );
      })}
    </View>
  );
}

/* ---------- Overtime ------------------------------------------------------- */

function OtSection({ items, busy, run }: RunProps & { items: OtItem[] }) {
  return (
    <View className="gap-3">
      {items.map((o) => (
        <ItemCard
          key={o.id}
          title={o.name}
          lines={[dayLabel(o.date), otMeta(o), o.reason ? `“${o.reason}”` : null]}
          warning={o.future ? `Dated ${dayLabel(o.date)}. Approve it on or after the day, from what was worked.` : null}
        >
          <Decide
            id={o.id}
            approveLabel={`Approve ${hoursLabel(o.hours_requested)}`}
            canApprove={!o.future}
            busy={busy}
            onApprove={() =>
              run(o.id, async () => otApprovedMessage(o.name, await approveOvertime(o.id)))
            }
            onReject={(why) =>
              run(o.id, async () => {
                await rejectOvertime(o.id, why);
                return { tone: "ok", text: `Rejected ${o.name}'s overtime on ${dayLabel(o.date)}.` };
              })
            }
          />
        </ItemCard>
      ))}
    </View>
  );
}

/* ---------- Leave ---------------------------------------------------------- */

function LeaveSection({ items, busy, run }: RunProps & { items: LeaveRequest[] }) {
  return (
    <View className="gap-3">
      {items.map((r) => {
        const name = r.user_name || "Someone";
        return (
          <ItemCard
            key={r.id}
            title={name}
            lines={[leaveMeta(r), r.outlet_name ?? null, r.reason ? `“${r.reason}”` : null]}
            warning={r.status === "ai_escalated" ? "The leave check passed this to you." : null}
            warningTone="info"
          >
            <Decide
              id={r.id}
              approveLabel="Approve"
              canApprove
              busy={busy}
              onApprove={() =>
                run(r.id, async () => {
                  try {
                    await approveLeave(r.id);
                  } catch (e) {
                    // Over the balance, or no balance row: decided in Office, never overridden from the phone.
                    if (e instanceof ApiError && e.status === 409 && overBalance(e.body)) {
                      return {
                        tone: "warn",
                        text: leaveOverBalanceMessage(name, e.message),
                      };
                    }
                    throw e;
                  }
                  return { tone: "ok", text: `Approved ${name}'s leave.` };
                })
              }
              onReject={(why) =>
                run(r.id, async () => {
                  await rejectLeave(r.id, why);
                  return { tone: "ok", text: `Rejected ${name}'s leave.` };
                })
              }
            />
          </ItemCard>
        );
      })}
    </View>
  );
}

/* ---------- Shift swaps ---------------------------------------------------- */

function SwapSection({ items, busy, run }: RunProps & { items: SwapRequest[] }) {
  return (
    <View className="gap-3">
      {items.map((s) => (
        <ItemCard key={s.id} title={swapTitle(s)} lines={[swapMeta(s), s.reason ? `“${s.reason}”` : null]}>
          <Decide
            id={s.id}
            approveLabel="Approve swap"
            canApprove
            busy={busy}
            onApprove={() =>
              run(s.id, async () => {
                await approveSwap(s.id);
                return { tone: "ok", text: `Approved the swap between ${swapTitle(s)}.` };
              })
            }
            onReject={(why) =>
              run(s.id, async () => {
                await rejectSwap(s.id, why);
                return { tone: "ok", text: `Rejected the swap between ${swapTitle(s)}.` };
              })
            }
          />
        </ItemCard>
      ))}
    </View>
  );
}

/* ---------- Pieces --------------------------------------------------------- */

function ItemCard({
  title,
  lines,
  warning,
  warningTone = "warn",
  children,
}: {
  title: string;
  lines: (string | null | undefined)[];
  warning?: string | null;
  warningTone?: "warn" | "info";
  children: ReactNode;
}) {
  const C = useCelsius().color;
  return (
    <Card>
      <Text className="text-base font-body-semi text-text" numberOfLines={1}>
        {title}
      </Text>
      {lines.filter(Boolean).map((l, i) => (
        <Text key={i} className="mt-0.5 text-sm font-body text-text-2" style={{ fontVariant: ["tabular-nums"] }}>
          {l}
        </Text>
      ))}
      {warning ? (
        <View className="mt-2 flex-row items-start gap-2">
          <AlertTriangle color={C[warningTone === "warn" ? "warn-text" : "info-text"]} size={16} />
          <Text className={`flex-1 text-sm font-body ${warningTone === "warn" ? "text-warn-text" : "text-info-text"}`}>
            {warning}
          </Text>
        </View>
      ) : null}
      <View className="mt-3">{children}</View>
    </Card>
  );
}

/** Approve in one tap; Reject asks for a reason first, then one tap. */
function Decide({
  id,
  approveLabel,
  canApprove,
  busy,
  onApprove,
  onReject,
}: {
  id: string;
  approveLabel: string;
  canApprove: boolean;
  busy: string | null;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const mine = busy === id;
  const locked = !!busy && !mine;

  if (rejecting) {
    const ok = why.trim().length >= 3;
    return (
      <View className="gap-3">
        <Field
          label="Reason"
          value={why}
          onChangeText={setWhy}
          placeholder="Why it's rejected, the person sees this"
          autoFocus
          maxLength={300}
          hint={ok ? undefined : "A few words, so they know why."}
        />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="Cancel" variant="ghost" size="sm" disabled={mine} onPress={() => setRejecting(false)} />
          </View>
          <View className="flex-1">
            <Button
              label="Reject"
              variant="danger"
              size="sm"
              loading={mine}
              disabled={!ok || locked}
              onPress={() => onReject(why.trim())}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <Button label="Reject" variant="secondary" size="sm" disabled={!!busy} onPress={() => setRejecting(true)} />
      </View>
      <View className="flex-1">
        <Button label={approveLabel} size="sm" loading={mine} disabled={!canApprove || locked} onPress={onApprove} />
      </View>
    </View>
  );
}

function OfficeLink({ onPress }: { onPress: () => void }) {
  const C = useCelsius().color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel="Open in Office"
      hitSlop={8}
      className="min-h-11 flex-row items-center gap-1 rounded-lg px-2 active:bg-sunken"
    >
      <Text className="text-sm font-body-semi text-text-2">Open in Office</Text>
      <ExternalLink color={C["text-2"]} size={14} />
    </Pressable>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const C = useCelsius().color;
  const look = {
    ok: { bg: "bg-ok-soft border-ok", text: "text-ok-text", color: C["ok-text"], Icon: CheckCircle2 },
    warn: { bg: "bg-warn-soft border-warn", text: "text-warn-text", color: C["warn-text"], Icon: AlertTriangle },
    danger: { bg: "bg-danger-soft border-danger", text: "text-danger-text", color: C["danger-text"], Icon: XCircle },
  }[notice.tone];
  return (
    <Pressable
      onPress={onClose}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${notice.text} Tap to dismiss.`}
      className={`mb-2 min-h-11 flex-row items-start gap-2 rounded-xl border px-3 py-2.5 ${look.bg}`}
    >
      <look.Icon color={look.color} size={18} />
      <Text className={`flex-1 text-sm font-body-semi ${look.text}`}>{notice.text}</Text>
    </Pressable>
  );
}

export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";

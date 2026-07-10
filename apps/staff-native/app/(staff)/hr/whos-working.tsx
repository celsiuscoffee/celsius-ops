import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchWhosWorking, type TeamMate } from "../../../lib/hr/api";

// Route-level boundary: a throw in THIS screen degrades to an inline retry
// card instead of unmounting the whole HR stack (the original Who's Working
// incident took the entire HR tab down and re-crashed it on every focus).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Seven days from today (device-local, which is MYT for staff). Each entry
// carries the YYYY-MM-DD key plus the display bits the picker needs.
function buildDays() {
  const out: { key: string; weekday: string; day: string; label: string | null }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    out.push({
      key: ymd(d),
      weekday: d.toLocaleDateString([], { weekday: "short" }),
      day: d.toLocaleDateString([], { day: "numeric" }),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : null,
    });
  }
  return out;
}

export default function WhosWorkingScreen() {
  const days = useMemo(buildDays, []);
  const [selected, setSelected] = useState(days[0].key);

  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-whos-working", selected],
    queryFn: () => fetchWhosWorking(selected),
    staleTime: 60_000,
  });
  const team = data?.team ?? [];
  const selectedLabel = days.find((d) => d.key === selected)?.label ?? null;
  const suffix = selectedLabel ? ` ${selectedLabel.toLowerCase()}` : "";

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Who's Working" back />

      {/* Day picker */}
      <View className="border-b border-border pb-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-1"
        >
          {days.map((d) => {
            const on = d.key === selected;
            return (
              <Pressable
                key={d.key}
                onPress={() => setSelected(d.key)}
                className={`w-14 items-center rounded-2xl border py-2 active:opacity-80 ${
                  on ? "border-primary bg-primary" : "border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-[11px] font-body-semi uppercase ${
                    on ? "text-background" : "text-muted-fg"
                  }`}
                >
                  {d.weekday}
                </Text>
                <Text
                  className={`text-lg font-display-medium ${
                    on ? "text-background" : "text-espresso"
                  }`}
                >
                  {d.day}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-danger text-center">
            {(error as Error).message}
          </Text>
        </View>
      ) : team.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
            <Users color="#A2492C" size={22} />
          </View>
          <Text className="text-base font-display-medium text-espresso">
            No one scheduled{suffix}
          </Text>
          <Text className="mt-1 text-sm text-muted-fg text-center">
            Once the schedule is published, your team's shifts show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="pt-3 pb-6"
          data={team}
          keyExtractor={(m, i) => `${m.user_id}-${i}`}
          ItemSeparatorComponent={() => <View className="h-2.5" />}
          renderItem={({ item }) => <TeamRow member={item} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text className="mb-3 text-sm font-body text-muted-fg">
              {team.length} on shift{suffix}
            </Text>
          }
        />
      )}
    </Screen>
  );
}

function TeamRow({ member }: { member: TeamMate }) {
  return (
    <View
      className={`flex-row items-center gap-3 rounded-3xl border p-4 ${
        member.is_me ? "border-primary/40 bg-primary-50" : "border-border bg-surface"
      }`}
    >
      <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
        <Text className="text-base font-display-medium text-primary">
          {initials(member.name)}
        </Text>
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-body-semi text-espresso">{member.name}</Text>
          {member.is_me ? (
            <View className="rounded-full bg-espresso px-2 py-0.5">
              <Text className="text-[10px] font-body-semi text-background">You</Text>
            </View>
          ) : null}
        </View>
        <View className="mt-1 flex-row items-center gap-2">
          <Text className="text-sm font-body-medium text-muted-fg">
            {fmtTime(member.start_time)} - {fmtTime(member.end_time)}
          </Text>
          {member.position ? (
            <View className="rounded-full bg-primary-100 px-2 py-0.5">
              <Text className="text-[11px] font-body-semi text-primary-900">
                {member.position}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// Both formatters guard against schema drift (null times/names in a roster
// row): a render throw here would otherwise cost the whole screen.
function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "?";
}

function fmtTime(t: string | null | undefined): string {
  const [h, m] = (t ?? "").split(":");
  const hn = Number(h);
  const mn = Number(m);
  if (!Number.isFinite(hn) || !Number.isFinite(mn) || h === "" || m == null) {
    return "-";
  }
  const d = new Date();
  d.setHours(hn, mn, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

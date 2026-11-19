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
import { hm12, useCelsius } from "../../../lib/celsius-ui";

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
  const C = useCelsius().color;
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
      <PageHeader title="Who's working" back />

      {/* Day picker */}
      <View className="border-b border-line pb-3">
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
                  on ? "border-ink bg-ink" : "border-line bg-surface"
                }`}
              >
                <Text
                  className={`text-xs font-body-semi ${
                    on ? "text-on-ink" : "text-text-2"
                  }`}
                >
                  {d.weekday}
                </Text>
                <Text
                  className={`text-lg font-display-medium ${
                    on ? "text-on-ink" : "text-text"
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
          <Text className="text-sm text-danger-text text-center">
            {(error as Error).message}
          </Text>
        </View>
      ) : team.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-sunken">
            <Users color={C["text-2"]} size={22} />
          </View>
          <Text className="text-base font-display-medium text-text">
            No one scheduled{suffix}
          </Text>
          <Text className="mt-1 text-sm text-text-2 text-center">
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
            <Text className="mb-3 text-sm font-body text-text-2">
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
      className={`flex-row items-center gap-3 rounded-2xl border p-4 ${
        member.is_me ? "border-line-2 bg-sunken" : "border-line bg-surface"
      }`}
    >
      <View className="h-11 w-11 items-center justify-center rounded-2xl bg-sunken">
        <Text className="text-base font-display-medium text-text">
          {initials(member.name)}
        </Text>
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-body-semi text-text">{member.name}</Text>
          {member.is_me ? (
            <View className="rounded-full bg-ink px-2 py-0.5">
              <Text className="text-xs font-body-semi text-on-ink">You</Text>
            </View>
          ) : null}
        </View>
        <View className="mt-1 flex-row items-center gap-2">
          <Text className="text-sm font-body-medium text-text-2">
            {fmtTime(member.start_time)} – {fmtTime(member.end_time)}
          </Text>
          {member.position ? (
            <View className="rounded-full bg-sunken px-2 py-0.5">
              <Text className="text-xs font-body-semi text-text-2">
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
  return hm12(`${hn}:${String(mn).padStart(2, "0")}`);
}

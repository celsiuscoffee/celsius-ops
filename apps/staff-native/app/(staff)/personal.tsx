import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { Screen } from "../../components/Screen";
import { PageHeader } from "../../components/PageHeader";
import * as Haptics from "expo-haptics";
import { Check, ChevronDown, ChevronLeft, Minus, Plus } from "lucide-react-native";
import {
  fetchProfile,
  saveProfile,
  type Profile,
} from "../../lib/hr/profile";

const GENDERS = ["Male", "Female"];
const RACES = ["Malay", "Chinese", "Indian", "Bumiputera", "Other"];
const RELIGIONS = ["Islam", "Buddhism", "Christianity", "Hinduism", "Other", "None"];
const MARITAL = ["single", "married", "divorced", "widowed"];
const STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka",
  "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya",
  "Sabah", "Sarawak", "Selangor", "Terengganu",
];
const TSHIRT = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

type Field = keyof Profile;

export default function PersonalScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [percent, setPercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Partial<Profile>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetchProfile();
      setProfile(res.profile);
      setPercent(res.completeness.percent);
    } catch (e) {
      Alert.alert("Couldn't load", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function set<K extends Field>(key: K, value: Profile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setDirty((d) => ({ ...d, [key]: value }));
  }

  async function onSave(markComplete: boolean) {
    if (Object.keys(dirty).length === 0 && !markComplete) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      const res = await saveProfile(dirty, markComplete);
      setProfile(res.profile);
      setDirty({});
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !profile) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#C2452D" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      {/* Sticky header */}
      <PageHeader
          title="Personal info"
          subtitle="Address, IC, emergency contact"
          back
        />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="pb-40"
          keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
          {/* Completeness */}
          <View className="rounded-2xl border border-border bg-surface p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-body-semi text-espresso">
                Profile completeness
              </Text>
              <Text className="text-sm font-body-bold text-primary">
                {percent}%
              </Text>
            </View>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-primary-50">
              <View
                className="h-full rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </View>
            <Text className="mt-2 text-xs font-body text-muted-fg">
              HR uses this for statutory + payroll. Fill it once and forget it.
            </Text>
          </View>

          <Section title="Identity">
            <DateField
              label="Date of birth"
              value={profile.date_of_birth}
              onChange={(v) => set("date_of_birth", v)}
            />
            <PickerField
              label="Gender"
              value={profile.gender}
              options={GENDERS}
              onChange={(v) => set("gender", v)}
            />
            <PickerField
              label="Race"
              value={profile.race}
              options={RACES}
              onChange={(v) => set("race", v)}
            />
            <PickerField
              label="Religion"
              value={profile.religion}
              options={RELIGIONS}
              onChange={(v) => set("religion", v)}
            />
          </Section>

          <Section title="Address">
            <TextField
              label="Address line 1"
              value={profile.address_line1}
              onChange={(v) => set("address_line1", v)}
            />
            <TextField
              label="Address line 2 (optional)"
              value={profile.address_line2}
              onChange={(v) => set("address_line2", v)}
            />
            <TextField
              label="City"
              value={profile.address_city}
              onChange={(v) => set("address_city", v)}
            />
            <PickerField
              label="State"
              value={profile.address_state}
              options={STATES}
              onChange={(v) => set("address_state", v)}
            />
            <TextField
              label="Postcode"
              value={profile.address_postcode}
              onChange={(v) => set("address_postcode", v)}
              keyboardType="number-pad"
              maxLength={5}
            />
          </Section>

          <Section title="Family">
            <PickerField
              label="Marital status"
              value={profile.marital_status}
              options={MARITAL.map((m) => m[0].toUpperCase() + m.slice(1))}
              onChange={(v) => set("marital_status", v?.toLowerCase() ?? null)}
            />
            {profile.marital_status === "married" ? (
              <>
                <TextField
                  label="Spouse name"
                  value={profile.spouse_name}
                  onChange={(v) => set("spouse_name", v)}
                />
                <BoolField
                  label="Is your spouse working?"
                  value={profile.spouse_working}
                  onChange={(v) => set("spouse_working", v)}
                />
              </>
            ) : null}
            <StepperField
              label="Number of children"
              value={profile.num_children ?? 0}
              onChange={(v) => set("num_children", v)}
            />
          </Section>

          <Section title="Contact">
            <TextField
              label="Personal email"
              value={profile.personal_email}
              onChange={(v) => set("personal_email", v)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextField
              label="Secondary phone (optional)"
              value={profile.secondary_phone}
              onChange={(v) => set("secondary_phone", v)}
              keyboardType="phone-pad"
            />
          </Section>

          <Section title="Emergency contact">
            <TextField
              label="Name"
              value={profile.emergency_contact_name}
              onChange={(v) => set("emergency_contact_name", v)}
            />
            <TextField
              label="Phone"
              value={profile.emergency_contact_phone}
              onChange={(v) => set("emergency_contact_phone", v)}
              keyboardType="phone-pad"
            />
          </Section>

          <Section title="Misc">
            <PickerField
              label="T-shirt size"
              value={profile.t_shirt_size}
              options={TSHIRT}
              onChange={(v) => set("t_shirt_size", v)}
            />
            <TextField
              label="Dietary restrictions"
              value={profile.dietary_restrictions}
              onChange={(v) => set("dietary_restrictions", v)}
            />
            <TextField
              label="Highest education"
              value={profile.education_level}
              onChange={(v) => set("education_level", v)}
            />
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Pinned bottom CTA, floating above tab bar */}
      <View
        style={{
          paddingBottom: 12,
          shadowColor: "#160800",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
        }}
        className="absolute inset-x-0 bottom-0 bg-background px-4 pt-3 pb-3"
      >
        <Pressable
          onPress={() => onSave(percent === 100)}
          disabled={saving}
          className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl ${
            saving ? "bg-primary/50" : "bg-primary active:opacity-90"
          }`}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-body-bold text-white">
              {Object.keys(dirty).length > 0 ? "Save changes" : "Done"}
            </Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
        {title}
      </Text>
      <View className="gap-2">{children}</View>
    </View>
  );
}

function TextField({
  label,
  value,
  onChange,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  keyboardType?: "default" | "number-pad" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "sentences";
  maxLength?: number;
}) {
  return (
    <View>
      <Text className="mb-1 text-xs font-body text-muted">{label}</Text>
      <TextInput
        value={value ?? ""}
        onChangeText={(t) => onChange(t === "" ? null : t)}
        placeholder="-"
        placeholderTextColor="#9B9B9B"
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        maxLength={maxLength}
        className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
      />
    </View>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  // Default to a sensible adult DOB (25 years ago) if nothing set yet.
  const parsed =
    value && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? {
          year: Number(value.slice(0, 4)),
          month: Number(value.slice(5, 7)),
          day: Number(value.slice(8, 10)),
        }
      : (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 25);
          return { year: d.getFullYear(), month: 1, day: 1 };
        })();

  const [year, setYear] = useState(parsed.year);
  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);

  const display = value
    ? new Date(value).toLocaleDateString([], {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 70 }, (_, i) => thisYear - 16 - i); // 16 → 85 yrs old
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const safeDay = day > daysInMonth ? daysInMonth : day;

  function confirm() {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
    onChange(iso);
    setOpen(false);
  }

  return (
    <View>
      <Text className="mb-1 text-xs font-body text-muted">{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel={label}
        className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
      >
        <Text
          className={`flex-1 text-base font-body ${
            display ? "text-espresso" : "text-muted"
          }`}
        >
          {display ?? "Select date"}
        </Text>
        <ChevronDown color="#9CA3AF" size={20} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Pressable onPress={() => setOpen(false)} className="px-2 py-1">
              <Text className="text-sm font-body-bold text-muted">Cancel</Text>
            </Pressable>
            <Text className="text-base font-display text-espresso">{label}</Text>
            <Pressable onPress={confirm} className="px-2 py-1">
              <Text className="text-sm font-body-bold text-primary">Done</Text>
            </Pressable>
          </View>

          <View className="flex-1 flex-row gap-2 p-4">
            {/* Day column */}
            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
            >
              {days.map((d) => {
                const active = d === safeDay;
                return (
                  <Pressable
                    key={d}
                    onPress={() => setDay(d)}
                    className={`mb-1 h-12 items-center justify-center rounded-xl ${
                      active ? "bg-primary" : ""
                    }`}
                  >
                    <Text
                      className={`text-base font-body-bold tabular-nums ${
                        active ? "text-white" : "text-espresso"
                      }`}
                    >
                      {d}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Month column */}
            <ScrollView
              className="flex-[1.4]"
              showsVerticalScrollIndicator={false}
            >
              {months.map((m, i) => {
                const v = i + 1;
                const active = v === month;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMonth(v)}
                    className={`mb-1 h-12 items-center justify-center rounded-xl ${
                      active ? "bg-primary" : ""
                    }`}
                  >
                    <Text
                      className={`text-base font-body-bold ${
                        active ? "text-white" : "text-espresso"
                      }`}
                    >
                      {m}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Year column */}
            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
            >
              {years.map((y) => {
                const active = y === year;
                return (
                  <Pressable
                    key={y}
                    onPress={() => setYear(y)}
                    className={`mb-1 h-12 items-center justify-center rounded-xl ${
                      active ? "bg-primary" : ""
                    }`}
                  >
                    <Text
                      className={`text-base font-body-bold tabular-nums ${
                        active ? "text-white" : "text-espresso"
                      }`}
                    >
                      {y}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Preview */}
          <View className="border-t border-border px-5 py-4">
            <Text className="text-center text-base font-body-bold text-espresso">
              {new Date(year, month - 1, safeDay).toLocaleDateString([], {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PickerField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const display = value ? value[0].toUpperCase() + value.slice(1) : null;
  return (
    <View>
      <Text className="mb-1 text-xs font-body text-muted">{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
      >
        <Text
          className={`flex-1 text-base font-body ${
            display ? "text-espresso" : "text-muted"
          }`}
        >
          {display ?? "Select"}
        </Text>
        <ChevronDown color="#9CA3AF" size={20} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-xl font-display text-espresso">{label}</Text>
            <Pressable onPress={() => setOpen(false)} className="px-2 py-1">
              <Text className="text-sm font-body-bold text-primary">Close</Text>
            </Pressable>
          </View>
          <ScrollView className="flex-1" contentContainerClassName="px-5 py-4"
      showsVerticalScrollIndicator={false}
    >
            {options.map((opt) => {
              const active = (value ?? "").toLowerCase() === opt.toLowerCase();
              return (
                <Pressable
                  key={opt}
                  onPress={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`mb-2 h-14 flex-row items-center justify-between rounded-2xl border px-4 active:bg-primary-50 ${
                    active
                      ? "border-primary bg-primary-50"
                      : "border-border bg-surface"
                  }`}
                >
                  <Text className="flex-1 text-base font-body-semi text-espresso">
                    {opt}
                  </Text>
                  {active ? <Check color="#C2452D" size={20} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <View>
      <Text className="mb-1 text-xs font-body text-muted">{label}</Text>
      <View className="flex-row gap-2">
        {[
          { label: "Yes", v: true },
          { label: "No", v: false },
        ].map(({ label: l, v }) => {
          const active = value === v;
          return (
            <Pressable
              key={l}
              onPress={() => onChange(v)}
              className={`h-14 flex-1 items-center justify-center rounded-2xl border-2 ${
                active
                  ? "border-primary bg-primary-50"
                  : "border-border bg-surface"
              }`}
            >
              <Text
                className={`text-base font-body-bold ${
                  active ? "text-primary" : "text-muted-fg"
                }`}
              >
                {l}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StepperField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const { colorScheme } = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#FAFAFA" : "#160800";
  return (
    <View>
      <Text className="mb-1 text-xs font-body text-muted">{label}</Text>
      <View className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-2">
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          className="h-10 w-10 items-center justify-center rounded-xl active:bg-primary-50"
        >
          <Minus color={iconColor} size={20} />
        </Pressable>
        <Text className="text-2xl font-display-medium text-espresso">
          {value}
        </Text>
        <Pressable
          onPress={() => onChange(value + 1)}
          className="h-10 w-10 items-center justify-center rounded-xl active:bg-primary-50"
        >
          <Plus color={iconColor} size={20} />
        </Pressable>
      </View>
    </View>
  );
}

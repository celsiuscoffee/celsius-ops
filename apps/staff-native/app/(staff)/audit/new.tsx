import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Check, ChevronDown } from "lucide-react-native";
import {
  createAudit,
  listAuditOutlets,
  listAuditTemplates,
  listAuditees,
  type AuditAuditee,
  type AuditOutlet,
  type AuditTemplate,
} from "../../../lib/ops/audits";

export default function NewAudit() {
  const router = useRouter();
  const [templates, setTemplates] = useState<AuditTemplate[]>([]);
  const [outlets, setOutlets] = useState<AuditOutlet[]>([]);
  const [auditees, setAuditees] = useState<AuditAuditee[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [auditeeId, setAuditeeId] = useState("");
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState<"template" | "outlet" | "auditee" | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, o] = await Promise.all([
          listAuditTemplates().catch(() => []),
          listAuditOutlets().catch(() => []),
        ]);
        if (cancelled) return;
        setTemplates(t);
        setOutlets(o);
        if (o.length === 1) setOutletId(o[0].id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );
  const isStaff = template?.auditTarget === "STAFF";

  useEffect(() => {
    if (!isStaff || !templateId || !outletId) {
      setAuditees([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await listAuditees(templateId, outletId);
        if (!cancelled) setAuditees(data);
      } catch {
        if (!cancelled) setAuditees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff, templateId, outletId]);

  const canCreate = !!templateId && !!outletId && (!isStaff || !!auditeeId);

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const data = await createAudit({
        templateId,
        outletId,
        auditeeId: isStaff ? auditeeId : undefined,
      });
      router.replace(`/audit/${data.id}`);
    } catch (e) {
      Alert.alert(
        "Couldn't start",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#A2492C" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-5 pt-6 pb-12">
        <Text className="text-3xl font-display text-espresso">New audit</Text>
        <Text className="mt-1 text-sm font-body text-muted-fg">
          Pick a template and outlet to start.
        </Text>

        <SelectorField
          label="Template"
          value={template?.name ?? ""}
          placeholder="Select template"
          onPress={() => setPicker("template")}
        />

        <SelectorField
          label="Outlet"
          value={outlets.find((o) => o.id === outletId)?.name ?? ""}
          placeholder="Select outlet"
          onPress={() => setPicker("outlet")}
          disabled={outlets.length === 1}
        />

        {isStaff ? (
          <SelectorField
            label="Staff to audit"
            value={auditees.find((a) => a.id === auditeeId)?.name ?? ""}
            placeholder={
              auditees.length === 0 ? "No matching staff" : "Select staff"
            }
            onPress={() => auditees.length > 0 && setPicker("auditee")}
            disabled={auditees.length === 0}
          />
        ) : null}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3 pb-8">
        <Pressable
          onPress={handleCreate}
          disabled={!canCreate || creating}
          className={`h-14 items-center justify-center rounded-2xl ${
            canCreate && !creating ? "bg-primary" : "bg-primary/40"
          }`}
        >
          {creating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-body-bold text-white">
              Start audit
            </Text>
          )}
        </Pressable>
      </View>

      {/* Pickers */}
      <Modal
        visible={picker !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPicker(null)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-xl font-display text-espresso">
              {picker === "template"
                ? "Templates"
                : picker === "outlet"
                  ? "Outlets"
                  : "Staff"}
            </Text>
            <Pressable onPress={() => setPicker(null)} className="px-2 py-1">
              <Text className="text-sm font-body-bold text-muted">Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="px-5 py-4 gap-2">
            {picker === "template"
              ? templates.map((t) => (
                  <PickerRow
                    key={t.id}
                    label={t.name}
                    sub={`${t.sections.reduce((s, sec) => s + sec._count.items, 0)} items`}
                    selected={t.id === templateId}
                    onPress={() => {
                      setTemplateId(t.id);
                      setAuditeeId("");
                      setPicker(null);
                    }}
                  />
                ))
              : picker === "outlet"
                ? outlets.map((o) => (
                    <PickerRow
                      key={o.id}
                      label={o.name}
                      selected={o.id === outletId}
                      onPress={() => {
                        setOutletId(o.id);
                        setAuditeeId("");
                        setPicker(null);
                      }}
                    />
                  ))
                : auditees.map((a) => (
                    <PickerRow
                      key={a.id}
                      label={a.name}
                      sub={a.position ?? undefined}
                      selected={a.id === auditeeId}
                      onPress={() => {
                        setAuditeeId(a.id);
                        setPicker(null);
                      }}
                    />
                  ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function SelectorField({
  label,
  value,
  placeholder,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="mt-5">
      <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={`h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50 ${disabled ? "opacity-60" : ""}`}
      >
        <Text
          className={`flex-1 text-base font-body ${value ? "text-espresso" : "text-muted"}`}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <ChevronDown color="#9CA3AF" size={18} />
      </Pressable>
    </View>
  );
}

function PickerRow({
  label,
  sub,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between rounded-2xl border px-4 py-3 active:bg-primary-50 ${
        selected ? "border-primary bg-primary-50" : "border-border bg-surface"
      }`}
    >
      <View className="flex-1">
        <Text className="text-base font-body-semi text-espresso">{label}</Text>
        {sub ? (
          <Text className="text-xs font-body text-muted">{sub}</Text>
        ) : null}
      </View>
      {selected ? <Check color="#A2492C" size={18} /> : null}
    </Pressable>
  );
}

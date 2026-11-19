import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react-native";
import { useCelsius } from "@/lib/celsius-ui";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WK = ["S", "M", "T", "W", "T", "F", "S"];

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function fmtD(s: string): string {
  const d = new Date(`${s}T12:00:00+08:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
function mytTodayParts() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

type Props = {
  visible: boolean;
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
};

export function RangeSheet({ visible, from, to, onApply, onClose }: Props) {
  const C = useCelsius().color;
  const [dStart, setDStart] = useState(from);
  const [dEnd, setDEnd] = useState<string | null>(to);
  const [calY, setCalY] = useState(2026);
  const [calM, setCalM] = useState(0);
  const [pickMonth, setPickMonth] = useState(false);

  useEffect(() => {
    if (visible) {
      setDStart(from);
      setDEnd(to);
      const e = new Date(`${to}T12:00:00+08:00`);
      setCalY(e.getFullYear());
      setCalM(e.getMonth());
      setPickMonth(false);
    }
  }, [visible, from, to]);

  const pick = (ds: string) => {
    if (!dStart || dEnd) { setDStart(ds); setDEnd(null); }
    else if (ds < dStart) { setDEnd(dStart); setDStart(ds); }
    else setDEnd(ds);
  };

  const preset = (r: string) => {
    const t = mytTodayParts();
    const today = new Date(Date.UTC(t.y, t.m, t.d));
    let s = new Date(today);
    let e = today;
    if (r === "tm") s = new Date(Date.UTC(t.y, t.m, 1));
    else if (r === "lm") { s = new Date(Date.UTC(t.y, t.m - 1, 1)); e = new Date(Date.UTC(t.y, t.m, 0)); }
    else s = new Date(today.getTime() - (Number(r) - 1) * 86400000);
    onApply(ymd(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()), ymd(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
  };

  // Compute the grid alignment in MYT, not device-local time. On devices
  // behind UTC+8 a local first-of-month can land on the previous day and
  // shift the whole calendar by one column. Anchor to +08:00 (matching
  // fmtD / dowMYT) so the grid is stable regardless of device timezone.
  const startDow = new Date(`${ymd(calY, calM, 1)}T12:00:00+08:00`).getUTCDay();
  const daysIn = new Date(Date.UTC(calY, calM + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);

  const PRESETS = [
    { r: "7", label: "7 days" }, { r: "14", label: "14 days" }, { r: "30", label: "30 days" },
    { r: "tm", label: "This month" }, { r: "lm", label: "Last month" },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-scrim" />
      <View className="absolute bottom-0 left-0 right-0 rounded-t-[28px] border-t border-line bg-raised px-5 pb-9 pt-2">
        <View className="mx-auto mb-4 mt-1.5 h-1 w-10 rounded-full bg-line-2" />
        <Text className="mb-4 font-display text-base text-text">Choose dates</Text>

        <View className="mb-4 flex-row flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Pressable key={p.r} onPress={() => preset(p.r)} className="h-11 justify-center rounded-full border border-line bg-sunken px-3.5 active:bg-line-2">
              <Text className="font-body-semi text-sm text-text-2">{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <View className="mb-2 flex-row items-center justify-between">
          <Pressable hitSlop={10} onPress={() => {
            if (pickMonth) { setCalY(calY - 1); return; }
            const m = calM - 1; if (m < 0) { setCalM(11); setCalY(calY - 1); } else setCalM(m);
          }} className="h-11 w-11 items-center justify-center">
            <ChevronLeft color={C["text-2"]} size={20} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setPickMonth((v) => !v)} className="min-h-11 flex-row items-center gap-1 px-2">
            <Text className="font-display text-sm text-text">{pickMonth ? `${calY}` : `${MON[calM]} ${calY}`}</Text>
            <ChevronDown color={C["text-2"]} size={16} />
          </Pressable>
          <Pressable hitSlop={10} onPress={() => {
            if (pickMonth) { setCalY(calY + 1); return; }
            const m = calM + 1; if (m > 11) { setCalM(0); setCalY(calY + 1); } else setCalM(m);
          }} className="h-11 w-11 items-center justify-center">
            <ChevronRight color={C["text-2"]} size={20} />
          </Pressable>
        </View>

        {pickMonth ? (
          <View className="flex-row flex-wrap py-1">
            {MON.map((m, i) => (
              <Pressable key={m} onPress={() => { setCalM(i); setPickMonth(false); }} style={{ width: `${100 / 3}%` }} className="px-1 py-1.5">
                <View className={`items-center rounded-xl py-3 ${i === calM ? "bg-ink" : "bg-sunken"}`}>
                  <Text className={`text-sm ${i === calM ? "font-body-bold text-on-ink" : "font-body text-text"}`}>{m}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="flex-row flex-wrap">
            {WK.map((d, i) => (
              <View key={`w${i}`} style={{ width: `${100 / 7}%` }} className="py-1">
                <Text className="text-center text-xs font-body-semi text-text-3">{d}</Text>
              </View>
            ))}
            {cells.map((d, i) => {
              if (d == null) return <View key={`e${i}`} style={{ width: `${100 / 7}%` }} className="py-2.5" />;
              const ds = ymd(calY, calM, d);
              const inRange = !!(dStart && dEnd && ds >= dStart && ds <= dEnd);
              const isEnd = ds === dStart || ds === dEnd;
              return (
                <Pressable key={`d${i}`} onPress={() => pick(ds)} style={{ width: `${100 / 7}%` }} className="items-center py-1">
                  <View className={`h-9 w-9 items-center justify-center rounded-xl ${isEnd ? "bg-ink" : inRange ? "bg-sunken" : ""}`}>
                    <Text className={`text-sm ${isEnd ? "font-body-bold text-on-ink" : "font-body text-text"}`}>{d}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text className="mt-3 text-center text-xs font-body-semi text-text-2">
          {dEnd ? `${fmtD(dStart)} to ${fmtD(dEnd)}` : dStart ? `${fmtD(dStart)} to tap end date…` : "Tap a start date…"}
        </Text>

        <Pressable
          disabled={!dStart || !dEnd}
          onPress={() => dStart && dEnd && onApply(dStart, dEnd)}
          className={`mt-4 h-[52px] items-center justify-center rounded-xl ${dStart && dEnd ? "bg-ink" : "bg-ink opacity-40"}`}
        >
          <Text className="font-body-semi text-base text-on-ink">Apply</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

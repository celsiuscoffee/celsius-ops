import { useMemo, useState } from "react";
import { PanResponder, Text, View } from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText } from "react-native-svg";
import type { SeriesPoint } from "@/lib/sales/dashboard";

const CUR = "#FBBF24"; // amber — current period
const PREV = "#8FB3F0"; // blue — previous period
const GRID = "rgba(245,243,240,0.08)";
const AXIS = "rgba(245,243,240,0.40)";

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
function kfmt(v: number): string {
  return v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`;
}
function rmShort(v: number): string {
  return "RM " + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Cumulative ("running total") overlay: current (amber) vs previous (blue),
 * with a draggable hour marker + tooltip showing each period's total at that
 * point. The marker defaults to the latest point that has data ("now").
 */
export function AccumChart({
  series,
  curLabel = "Today",
  prevLabel = "Yesterday",
  height = 210,
}: {
  series: SeriesPoint[];
  curLabel?: string;
  prevLabel?: string;
  height?: number;
}) {
  const [w, setW] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  let p = 0;
  let c = 0;
  const cumPrev = series.map((s) => (p += s.prev));
  const cumCur = series.map((s) => (s.cur == null ? null : (c += s.cur)));
  const curNums = cumCur.filter((x): x is number => x != null);
  const max = niceMax(Math.max(1, ...cumPrev, ...curNums));

  const padL = 40, padR = 12, padT = 8, padB = 22;
  const n = series.length;
  const innerW = Math.max(0, w - padL - padR);
  const innerH = height - padT - padB;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + (1 - v / max) * innerH;

  const lastCur = cumCur.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
  const idx = Math.max(0, Math.min(n - 1, active ?? (lastCur >= 0 ? lastCur : n - 1)));

  function pick(lx: number) {
    if (n <= 1 || innerW <= 0) return;
    const i = Math.round(((lx - padL) / innerW) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  }
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
      }),
    // pick closes over innerW/padL/n — refresh when width or point count changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, n],
  );

  const toPath = (arr: (number | null)[]) => {
    let d = "";
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const step = Math.max(1, Math.ceil(n / 6));

  const curV = cumCur[idx];
  const prevV = cumPrev[idx] ?? 0;
  const TW = 162;
  const tipLeft = x(idx) + 12 + TW <= w - 4 ? x(idx) + 12 : Math.max(4, x(idx) - 12 - TW);

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
      {w > 0 ? (
        <>
          <Svg width={w} height={height}>
            {grid.map((g, i) => (
              <Line key={`g${i}`} x1={padL} y1={padT + g * innerH} x2={w - padR} y2={padT + g * innerH} stroke={GRID} strokeWidth={1} />
            ))}
            {grid.map((g, i) => (
              <SvgText key={`gl${i}`} x={padL - 6} y={padT + g * innerH + 3} fontSize={9} fill={AXIS} textAnchor="end">
                {kfmt(max * (1 - g))}
              </SvgText>
            ))}
            {series.map((s, i) =>
              i % step === 0 || i === n - 1 ? (
                <SvgText key={`x${i}`} x={x(i)} y={height - 6} fontSize={9} fill={AXIS} textAnchor="middle">
                  {s.label}
                </SvgText>
              ) : null,
            )}
            <Path d={toPath(cumPrev)} stroke={PREV} strokeWidth={2} fill="none" />
            <Path d={toPath(cumCur)} stroke={CUR} strokeWidth={2.5} fill="none" />
            {/* draggable hour marker */}
            <Line x1={x(idx)} y1={padT} x2={x(idx)} y2={padT + innerH} stroke={AXIS} strokeWidth={1} strokeDasharray="3 4" />
            <Circle cx={x(idx)} cy={y(prevV)} r={4} fill={PREV} />
            {curV != null ? <Circle cx={x(idx)} cy={y(curV)} r={4} fill={CUR} /> : null}
          </Svg>
          {/* tooltip callout */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: tipLeft,
              top: padT + 6,
              width: TW,
              backgroundColor: "#1d1109f2",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(245,243,240,0.12)",
              paddingVertical: 8,
              paddingHorizontal: 11,
              gap: 5,
            }}
          >
            <Text style={{ color: AXIS, fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" }}>
              {series[idx]?.label ?? ""}
            </Text>
            <TipRow color={CUR} label={curLabel} value={curV != null ? rmShort(curV) : "—"} />
            <TipRow color={PREV} label={prevLabel} value={rmShort(prevV)} />
          </View>
        </>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: "#F5F3F0", fontSize: 12.5, fontFamily: "SpaceGrotesk_500Medium", flex: 1 }}>{label}</Text>
      <Text style={{ color: "#F5F3F0", fontSize: 12.5, fontFamily: "SpaceGrotesk_700Bold" }}>{value}</Text>
    </View>
  );
}

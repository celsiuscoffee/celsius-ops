import { useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import Svg, { Path, Line, Circle, Rect, Text as SvgText } from "react-native-svg";
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
function rmTip(v: number): string {
  return "RM " + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Cumulative ("running total") overlay: current (amber) vs previous (blue).
 *  Tap or drag across the chart to scrub a tooltip showing both periods'
 *  running totals at that point (like the StoreHub chart). */
export function AccumChart({
  series,
  height = 210,
  curLabel = "Today",
  prevLabel = "Yesterday",
}: {
  series: SeriesPoint[];
  height?: number;
  curLabel?: string;
  prevLabel?: string;
}) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);

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

  // Geometry the gesture handlers read — kept in a ref so the PanResponder
  // (created once) always sees the current layout instead of a stale closure.
  const geo = useRef({ padL, innerW, n });
  geo.current = { padL, innerW, n };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => setSel(pick(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => setSel(pick(e.nativeEvent.locationX)),
    }),
  ).current;
  function pick(lx: number): number {
    const { padL, innerW, n } = geo.current;
    if (n <= 1 || innerW <= 0) return 0;
    const i = Math.round(((lx - padL) / innerW) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

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
  const lastCur = cumCur.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);

  // ── Tooltip geometry (when a point is selected) ──
  const selPrev = sel != null ? cumPrev[sel] : 0;
  const selCur = sel != null ? cumCur[sel] : null;
  const titleLine = sel != null ? series[sel].label : "";
  const curLine = `${curLabel}  ${selCur == null ? "—" : rmTip(selCur)}`;
  const prevLine = `${prevLabel}  ${rmTip(selPrev)}`;
  // SVG <Text> neither wraps nor clips, so a fixed width let longer strings
  // (e.g. "Yesterday  RM 1,812", or "Last month …") spill past the card edge.
  // Size the card to its widest line, capped to the chart's inner width.
  const tipChars = Math.max(curLine.length, prevLine.length, titleLine.length);
  const boxW = Math.min(w - padL - padR, Math.max(132, 30 + tipChars * 7));
  const boxH = 58;
  const selX = sel != null ? x(sel) : 0;
  const bx = Math.max(padL, Math.min(w - padR - boxW, selX - boxW / 2));
  const by = padT + 2;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
      {w > 0 ? (
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
          {n > 0 && cumPrev.length ? <Circle cx={x(n - 1)} cy={y(cumPrev[n - 1])} r={3} fill={PREV} /> : null}
          {lastCur >= 0 ? <Circle cx={x(lastCur)} cy={y(cumCur[lastCur] as number)} r={3.5} fill={CUR} /> : null}

          {/* ── Scrub selection + tooltip ── */}
          {sel != null ? (
            <>
              <Line x1={selX} y1={padT} x2={selX} y2={padT + innerH} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
              <Circle cx={selX} cy={y(selPrev)} r={4} fill={PREV} stroke="#160800" strokeWidth={1.5} />
              {selCur != null ? <Circle cx={selX} cy={y(selCur)} r={4} fill={CUR} stroke="#160800" strokeWidth={1.5} /> : null}
              <Rect x={bx} y={by} width={boxW} height={boxH} rx={8} fill="#160800" stroke="rgba(245,243,240,0.18)" strokeWidth={1} opacity={0.97} />
              <SvgText x={bx + 9} y={by + 16} fontSize={10} fill={AXIS}>{titleLine}</SvgText>
              <Circle cx={bx + 12} cy={by + 31} r={3} fill={CUR} />
              <SvgText x={bx + 20} y={by + 34} fontSize={11} fontWeight="600" fill="#F5F3F0">{curLine}</SvgText>
              <Circle cx={bx + 12} cy={by + 47} r={3} fill={PREV} />
              <SvgText x={bx + 20} y={by + 50} fontSize={11} fontWeight="600" fill="#F5F3F0">{prevLine}</SvgText>
            </>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

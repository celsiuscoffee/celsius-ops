import { useState } from "react";
import { View } from "react-native";
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

/** Cumulative ("running total") overlay: current (amber) vs previous (blue). */
export function AccumChart({ series, height = 210 }: { series: SeriesPoint[]; height?: number }) {
  const [w, setW] = useState(0);

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

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
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
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

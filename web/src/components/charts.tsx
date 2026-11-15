"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The chart's rendered width, so marks and text are drawn at real pixel sizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round number at or above `value`, for the top of the axis. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 4, 5, 10].map((m) => m * magnitude).find((m) => m >= value)!;
}

const HEIGHT = 180;
const PAD = { top: 12, right: 44, bottom: 22, left: 28 };

function Frame({
  width,
  max,
  xLabels,
  children,
}: {
  width: number;
  max: number;
  /** [fraction along the axis, text] */
  xLabels: [number, string][];
  children: ReactNode;
}) {
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  return (
    <>
      {[0, 0.5, 1].map((t) => {
        const y = PAD.top + plotH * (1 - t);
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y}
              y2={y}
              stroke="var(--rule)"
              strokeDasharray={t === 0 ? undefined : "2 4"}
            />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={12} fill="var(--ink-soft)">
              {max * t}
            </text>
          </g>
        );
      })}
      {xLabels.map(([t, text], i) => (
        <text
          key={text}
          x={PAD.left + plotW * t}
          y={HEIGHT - 4}
          fontSize={12}
          fill="var(--ink-soft)"
          textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
        >
          {text}
        </text>
      ))}
      {children}
    </>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the tooltip inside the chart by flipping it past the midpoint.
  const flip = x > width / 2;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 rounded-sm border border-rule bg-paper px-2 py-1 text-sm whitespace-nowrap shadow-sm"
      style={flip ? { right: width - x + 8 } : { left: x + 8 }}
    >
      {children}
    </div>
  );
}

export type Series = { name: string; color: string; values: number[] };

/** Change over time for one or two series, with a crosshair that reads out every series. */
export function LineChart({
  series,
  labels,
  title,
}: {
  series: Series[];
  /** One label per point, shown in the tooltip; the first, middle and last also sit on the axis. */
  labels: string[];
  title: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const count = labels.length;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values)));
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (plotW * i) / (count - 1);
  const y = (v: number) => PAD.top + plotH * (1 - v / max);

  // Direct labels at the line ends; nudge them apart if the lines finish close together.
  const ends = series
    .map((s) => ({ ...s, at: y(s.values[count - 1]) }))
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].at - ends[i - 1].at < 14) ends[i].at = ends[i - 1].at + 14;
  }

  return (
    <figure>
      <div className="flex flex-wrap gap-x-5 text-sm text-soft">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative mt-1">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={title}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const i = Math.round(((e.clientX - box.left - PAD.left) / plotW) * (count - 1));
              setActive(Math.max(0, Math.min(count - 1, i)));
            }}
            onPointerLeave={() => setActive(null)}
          >
            <Frame
              width={width}
              max={max}
              xLabels={[
                [0, labels[0]],
                [0.5, labels[Math.floor((count - 1) / 2)]],
                [1, labels[count - 1]],
              ]}
            >
              {active !== null && (
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--ink-soft)"
                />
              )}
              {series.map((s) => (
                <g key={s.name}>
                  <polyline
                    points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {active !== null && (
                    <circle
                      cx={x(active)}
                      cy={y(s.values[active])}
                      r={4}
                      fill={s.color}
                      stroke="var(--paper)"
                      strokeWidth={2}
                    />
                  )}
                </g>
              ))}
              {ends.map((s) => (
                <text key={s.name} x={x(count - 1) + 8} y={s.at + 4} fontSize={13} fill="var(--ink)">
                  {s.values[count - 1]}
                </text>
              ))}
            </Frame>
          </svg>
        )}
        {active !== null && (
          <Tooltip x={x(active)} width={width}>
            <span className="label">Week of {labels[active]}</span>
            {series.map((s) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                {s.name}: {s.values[active]}
              </span>
            ))}
          </Tooltip>
        )}
      </div>
      <DataTable
        caption={title}
        columns={["Week of", ...series.map((s) => s.name)]}
        rows={labels.map((label, i) => [label, ...series.map((s) => s.values[i])])}
      />
    </figure>
  );
}

/** Counts per day as thin columns, each with its own hover readout. */
export function ColumnChart({
  values,
  labels,
  title,
  unit,
  color,
}: {
  values: number[];
  labels: string[];
  title: string;
  /** Singular noun for the tooltip, e.g. "review". */
  unit: string;
  color: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const count = values.length;
  const max = niceMax(Math.max(...values));
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / count;
  const bar = Math.max(2, Math.min(24, band - 2));
  const center = (i: number) => PAD.left + band * (i + 0.5);

  return (
    <figure>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={title}
            onPointerLeave={() => setActive(null)}
          >
            <Frame
              width={width}
              max={max}
              xLabels={[
                [0.5 / count, labels[0]],
                [1 - 0.5 / count, labels[count - 1]],
              ]}
            >
              {values.map((v, i) => {
                const h = (plotH * v) / max;
                const r = Math.min(4, bar / 2, h);
                const left = center(i) - bar / 2;
                const top = PAD.top + plotH - h;
                return (
                  <g key={labels[i]} onPointerEnter={() => setActive(i)}>
                    {/* The hit target is the whole band, not just the thin mark. */}
                    <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" />
                    {v > 0 && (
                      <path
                        d={`M${left},${top + h} v${-(h - r)} q0,${-r} ${r},${-r} h${bar - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                        fill={color}
                        opacity={active === null || active === i ? 1 : 0.55}
                      />
                    )}
                  </g>
                );
              })}
            </Frame>
          </svg>
        )}
        {active !== null && (
          <Tooltip x={center(active)} width={width}>
            <span className="label">{labels[active]}</span>
            <span className="block">
              {values[active]} {values[active] === 1 ? unit : `${unit}s`}
            </span>
          </Tooltip>
        )}
      </div>
      <DataTable
        caption={title}
        columns={["Day", `${unit[0].toUpperCase()}${unit.slice(1)}s`]}
        rows={labels.map((label, i) => [label, values[i]])}
      />
    </figure>
  );
}

/** The same numbers as a table, for anyone who would rather read than hover. */
function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-1">
      <summary className="label cursor-pointer hover:text-ink">Show as a table</summary>
      <div className="mt-2 max-h-64 overflow-y-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="label border-b border-rule py-1 font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i} className="border-b border-rule py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

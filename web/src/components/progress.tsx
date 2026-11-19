"use client";

import { useState } from "react";
import { api, type Achievement, type Stats } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { ColumnChart, LineChart } from "./charts";
import { useMe } from "./shell";
import { Meter, Notice, Section } from "./ui";

/** "2026-03-09" to "9 Mar". Parsed as a plain calendar date, never shifted by time zone. */
function shortDate(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date} ${months[month - 1]}`;
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-4xl font-semibold tabular-nums">{value}</p>
      <p className="label">{label}</p>
    </div>
  );
}

function Charts({ stats }: { stats: Stats }) {
  const { stages } = stats;
  const reviews30 = stats.days.reduce((sum, d) => sum + d.reviews, 0);
  const dueSoon = stats.forecast.reduce((sum, d) => sum + d.due, 0);
  const weekLabels = stats.weeks.map((w) => shortDate(w.weekStart));

  return (
    <>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
        <Figure value={String(stages.studying)} label="Studying" />
        <Figure value={String(stages.reviewing)} label="Reviewing" />
        <Figure value={String(stages.mastered)} label="Mastered" />
        <Figure value={String(stages.known)} label="Already known" />
        <Figure
          value={stats.recallRate === null ? "–" : `${Math.round(stats.recallRate * 100)}%`}
          label="Recalled, 30 days"
        />
      </div>

      <Section title="Vocabulary growth · last 12 weeks">
        <LineChart
          title="Words studied and mastered, cumulative, by week"
          labels={weekLabels}
          series={[
            { name: "Studied", color: "var(--series-1)", values: stats.weeks.map((w) => w.studied) },
            { name: "Mastered", color: "var(--series-2)", values: stats.weeks.map((w) => w.mastered) },
          ]}
        />
      </Section>

      <Section title={`Reviews · last 30 days · ${reviews30} in all`}>
        <ColumnChart
          title="Reviews completed per day"
          unit="review"
          color="var(--series-1)"
          labels={stats.days.map((d) => shortDate(d.day))}
          values={stats.days.map((d) => d.reviews)}
        />
      </Section>

      <Section title={`Coming due · next 14 days · ${dueSoon} in all`}>
        <ColumnChart
          title="Reviews coming due per day"
          unit="review"
          color="var(--series-1)"
          labels={stats.forecast.map((d, i) => (i === 0 ? "Today" : shortDate(d.day)))}
          values={stats.forecast.map((d) => d.due)}
        />
      </Section>
    </>
  );
}

function Achievements({ achievements }: { achievements: Achievement[] }) {
  // Unlocked first (most recent at the top), then the nearest to completion.
  const sorted = [...achievements].sort((a, b) => {
    if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt);
    if (a.unlockedAt || b.unlockedAt) return a.unlockedAt ? -1 : 1;
    return b.progress / b.target - a.progress / a.target;
  });
  return (
    <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {sorted.map((a) => (
        <li key={a.code} className={a.unlockedAt ? "" : "text-soft"}>
          <p className="flex items-baseline justify-between gap-3">
            <span className="font-display text-xl font-semibold">{a.title}</span>
            {a.unlockedAt && (
              <span className="label shrink-0 text-good">
                {new Date(a.unlockedAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
          </p>
          <p className="text-soft">{a.description}</p>
          {!a.unlockedAt && (
            <Meter value={a.progress} max={a.target} label={`${a.progress} of ${a.target}`} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function Progress() {
  const me = useMe();
  const users = useResource(api.listUsers);
  const [userId, setUserId] = useState(me.id);
  const stats = useResource(() => api.stats(userId), userId);
  const achievements = useResource(() => api.achievements(userId), userId);
  const players = users.data?.users ?? [];

  return (
    <>
      {players.length > 1 && (
        <div className="mb-8 flex flex-wrap gap-x-5 gap-y-2">
          {players.map((u) => (
            <button
              key={u.id}
              onClick={() => setUserId(u.id)}
              aria-pressed={u.id === userId}
              className="label hover:text-ink aria-pressed:text-accent"
            >
              {u.id === me.id ? "You" : u.displayName}
            </button>
          ))}
        </div>
      )}

      {stats.error && <Notice>{stats.error.message}</Notice>}
      {/* Wait for the selected player's numbers rather than showing the previous player's. */}
      {stats.data?.user.id === userId ? (
        <Charts stats={stats.data} />
      ) : (
        !stats.error && <p className="text-soft">Tallying…</p>
      )}

      <Section title="Achievements">
        {achievements.error && <Notice>{achievements.error.message}</Notice>}
        {achievements.data && <Achievements achievements={achievements.data.achievements} />}
      </Section>
    </>
  );
}

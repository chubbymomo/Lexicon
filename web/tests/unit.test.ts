/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are checked by assertions */
import { describe, expect, it } from "vitest";
import { buildOpenApi } from "@/server/openapi";
import { dayKey, startOfDay, startOfWeek, streakLength } from "@/server/services/progress";
import {
  blankWord,
  isMastered,
  pickReviewKind,
  schedule,
  scheduleFirst,
} from "@/server/services/scheduling";

const DAY = 86_400_000;

describe("scheduling", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("first schedules a word at least a day out", () => {
    const card = scheduleFirst(now);
    expect(card.reps).toBe(1);
    expect(card.due!.getTime() - now.getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it("grows the interval with each successful review", () => {
    let card = scheduleFirst(now);
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      const at = card.due!;
      card = schedule(card, 3, at);
      intervals.push(card.due!.getTime() - at.getTime());
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    expect(isMastered(card)).toBe(true);
  });

  it("shortens the interval and records a lapse when a word is forgotten", () => {
    let card = scheduleFirst(now);
    card = schedule(card, 3, card.due!);
    const before = card.scheduledDays;
    const lapsed = schedule(card, 1, card.due!);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.scheduledDays).toBeLessThan(before);
    expect(isMastered(lapsed)).toBe(false);
  });

  it("rejects ratings outside 1 to 4", () => {
    expect(() => schedule(scheduleFirst(now), 0, now)).toThrow(RangeError);
    expect(() => schedule(scheduleFirst(now), 5, now)).toThrow(RangeError);
  });
});

describe("blankWord", () => {
  it("blanks the word and its inflections, whatever the case", () => {
    expect(blankWord("Ephemeral joys fade.", "ephemeral")).toBe("_____ joys fade.");
    expect(blankWord("The rule was obviated.", "obviate")).toBe("The rule was _____.");
    expect(blankWord("He spoke candidly.", "candid")).toBe("He spoke _____.");
  });

  it("does not blank the stem inside another word", () => {
    expect(blankWord("An uncandid reply.", "candid")).toBeNull();
  });

  it("returns null when the example lacks the word", () => {
    expect(blankWord("Nothing to see here.", "ephemeral")).toBeNull();
  });
});

describe("pickReviewKind", () => {
  it("mixes the three kinds", () => {
    expect(pickReviewKind(2, true, true)).toBe("DEFINITION_RECALL");
    expect(pickReviewKind(3, true, true)).toBe("WORD_FROM_CONTEXT");
    expect(pickReviewKind(4, true, true)).toBe("SENTENCE");
  });

  it("falls back when there is no tutor or no usable example", () => {
    expect(pickReviewKind(4, true, false)).toBe("DEFINITION_RECALL");
    expect(pickReviewKind(3, false, true)).toBe("DEFINITION_RECALL");
  });
});

describe("streaks and weeks", () => {
  it("counts consecutive days ending today", () => {
    expect(streakLength(["2026-03-10", "2026-03-09", "2026-03-08"], "2026-03-10")).toBe(3);
  });

  it("keeps the streak alive until today is over", () => {
    expect(streakLength(["2026-03-09", "2026-03-08"], "2026-03-10")).toBe(2);
  });

  it("breaks after a missed day", () => {
    expect(streakLength(["2026-03-08", "2026-03-07"], "2026-03-10")).toBe(0);
    expect(streakLength(["2026-03-10", "2026-03-08"], "2026-03-10")).toBe(1);
    expect(streakLength([], "2026-03-10")).toBe(0);
  });

  it("uses the household time zone for day boundaries", () => {
    const lateEvening = new Date("2026-03-11T03:30:00Z"); // 23:30 on the 10th in New York
    expect(dayKey(lateEvening, "America/New_York")).toBe("2026-03-10");
    expect(dayKey(lateEvening, "UTC")).toBe("2026-03-11");
    expect(startOfDay("2026-03-10", "America/New_York").toISOString()).toBe(
      "2026-03-10T04:00:00.000Z",
    );
    // The day clocks go back in New York: midnight is still on daylight time.
    expect(startOfDay("2026-11-01", "America/New_York").toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  it("starts the week on Monday", () => {
    expect(startOfWeek(new Date("2026-03-11T15:00:00Z"), "UTC").toISOString()).toBe(
      "2026-03-09T00:00:00.000Z",
    );
    // Sunday belongs to the week that began the previous Monday.
    expect(startOfWeek(new Date("2026-03-15T15:00:00Z"), "UTC").toISOString()).toBe(
      "2026-03-09T00:00:00.000Z",
    );
  });
});

describe("OpenAPI document", () => {
  it("describes every endpoint with resolvable references", () => {
    const doc = buildOpenApi() as any;
    const text = JSON.stringify(doc);
    expect(text).not.toContain("$defs");
    for (const [, ref] of text.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)) {
      expect(doc.components.schemas).toHaveProperty(ref);
    }
    expect(doc.paths["/words/{id}/sentences"].post.requestBody).toBeDefined();
    expect(doc.paths["/auth/login"].post.security).toEqual([]);
    expect(doc.paths["/words"].get.security).toEqual([{ bearerAuth: [] }]);
  });
});

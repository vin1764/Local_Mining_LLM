// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  MOVING_AVERAGE_WINDOW_MS,
  medianSamplingIntervalMs,
  movingAverage,
  parseTimestamp,
  type TimedValue,
} from "@/lib/moving-average";

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const min = (m: number) => T0 + m * 60_000;
const pts = (pairs: [number | null, number | null][]): TimedValue[] =>
  pairs.map(([t, value]) => ({ t, value }));
const avgs = (r: { avg: number | null }[]) =>
  r.map((x) => (x.avg === null ? null : Number(x.avg.toFixed(6))));

describe("one-hour moving average", () => {
  it("uses a 60-minute window", () => {
    expect(MOVING_AVERAGE_WINDOW_MS).toBe(3_600_000);
  });

  it("averages a complete hour of regularly sampled data", () => {
    // One reading every 10 minutes for 60 minutes: 0,10,...,50 → values 1..6
    const input = pts([0, 10, 20, 30, 40, 50].map((m, i) => [min(m), i + 1]));
    const r = movingAverage(input);
    expect(avgs(r)).toEqual([1, 1.5, 2, 2.5, 3, 3.5]);
    expect(r[5]!.count).toBe(6);
  });

  it("only uses the preceding hour when data spans several hours", () => {
    // Hourly blocks: 08:00-08:50 value 10, 09:00-09:50 value 20, 10:00-10:50 value 30
    const input: TimedValue[] = [];
    for (let h = 0; h < 3; h++)
      for (let m = 0; m < 60; m += 10)
        input.push({ t: min(h * 60 + m), value: (h + 1) * 10 });
    const r = movingAverage(input);
    // At 10:50 the window (09:50, 10:50] holds only the six 10:xx readings.
    expect(r[r.length - 1]!.avg).toBe(30);
    expect(r[r.length - 1]!.count).toBe(6);
    // At 10:00 the window (09:00, 10:00] holds 09:10..09:50 (5×20) and 10:00 (30).
    const at1000 = input.findIndex((p) => p.t === min(120));
    expect(r[at1000]!.avg).toBeCloseTo((5 * 20 + 30) / 6, 10);
  });

  it("excludes a reading exactly 60 minutes earlier and includes one just inside", () => {
    const r = movingAverage(
      pts([
        [min(0), 100], // exactly 60 min before the last point → outside
        [min(0) + 1, 50], // 59:59.999 before → inside
        [min(60), 10],
      ]),
    );
    expect(r[2]!.avg).toBe(30); // (50 + 10) / 2
    expect(r[2]!.count).toBe(2);
  });

  it("ignores missing and invalid values instead of treating them as zero", () => {
    const r = movingAverage(
      pts([
        [min(0), 10],
        [min(10), null],
        [min(20), Number.NaN],
        [min(30), Number.POSITIVE_INFINITY],
        [min(40), 20],
      ]),
    );
    expect(r[4]!.avg).toBe(15);
    expect(r[4]!.count).toBe(2);
    // A missing reading still gets the average of the valid readings around it.
    expect(r[1]!.avg).toBe(10);
    // A window with no valid values has no average.
    expect(movingAverage(pts([[min(0), null]]))[0]!.avg).toBeNull();
    // Readings without a valid timestamp get no average and are not used.
    const noTime = movingAverage(
      pts([
        [null, 99],
        [min(5), 1],
      ]),
    );
    expect(noTime[0]!.avg).toBeNull();
    expect(noTime[1]!.avg).toBe(1);
  });

  it("gives the same result for unsorted timestamps, in the caller's order", () => {
    const sorted = pts([
      [min(0), 1],
      [min(20), 2],
      [min(40), 3],
      [min(70), 4],
    ]);
    const shuffled = [sorted[2]!, sorted[0]!, sorted[3]!, sorted[1]!];
    const a = movingAverage(sorted);
    const b = movingAverage(shuffled);
    expect(b[0]).toEqual(a[2]);
    expect(b[1]).toEqual(a[0]);
    expect(b[2]).toEqual(a[3]);
    expect(b[3]).toEqual(a[1]);
    // At 09:10 the window (08:10, 09:10] holds 08:20, 08:40, 09:10 → (2+3+4)/3
    expect(a[3]!.avg).toBe(3);
  });

  it("uses timestamps, not row counts, for irregular sampling", () => {
    const input = pts([
      [min(0), 1],
      [min(1), 1],
      [min(2), 1],
      [min(3), 1],
      [min(58), 5],
      [min(100), 9], // 42 min gap; window (00:40, 01:40] holds 00:58 and 01:40
      [min(250), 7], // 2.5 h gap: alone in its window
    ]);
    const r = movingAverage(input);
    expect(r[4]!.avg).toBeCloseTo((4 + 5) / 5, 10);
    expect(r[5]!.avg).toBe(7);
    expect(r[5]!.count).toBe(2);
    expect(r[6]!.avg).toBe(7);
    expect(r[6]!.count).toBe(1);
  });

  it("counts readings that share a timestamp in each other's window", () => {
    const r = movingAverage(
      pts([
        [min(0), 2],
        [min(0), 4],
      ]),
    );
    expect(avgs(r)).toEqual([3, 3]);
  });

  it("returns an empty result for an empty dataset", () => {
    expect(movingAverage([])).toEqual([]);
    expect(medianSamplingIntervalMs([])).toBeNull();
  });
});

describe("timestamp parsing", () => {
  it("reads 'YYYY-MM-DD HH:MM' consistently and rejects junk", () => {
    expect(parseTimestamp("2026-09-01 08:30")).toBe(
      Date.parse("2026-09-01T08:30"),
    );
    expect(parseTimestamp("2026-09-01T08:30:00Z")).toBe(
      Date.UTC(2026, 8, 1, 8, 30),
    );
    expect(parseTimestamp("not a time")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });

  it("reports the median sampling interval", () => {
    expect(medianSamplingIntervalMs([min(0), min(10), min(20), min(50)])).toBe(
      10 * 60_000,
    );
  });
});

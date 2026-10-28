/**
 * One-hour moving average.
 *
 * A trailing (rolling) arithmetic mean: for each reading at time t it averages
 * every valid reading of the same parameter with a timestamp in the half-open
 * window (t − 60 min, t]. The window is decided by timestamps, not by a count
 * of rows, so irregular sampling and gaps are handled correctly:
 * - a reading exactly 60 minutes earlier is outside the window;
 * - readings at the same timestamp are all inside each other's window;
 * - missing or invalid values (null, NaN, ±Infinity) are excluded from the
 *   average, and a reading with no valid values in its window gets null;
 * - readings with an unparseable timestamp get null and are not used.
 * Input order does not matter: points are sorted by time internally and the
 * result is returned in the caller's order.
 */
export const MOVING_AVERAGE_WINDOW_MINUTES = 60;
export const MOVING_AVERAGE_WINDOW_MS = MOVING_AVERAGE_WINDOW_MINUTES * 60_000;
export const MOVING_AVERAGE_LABEL = "1-HOUR MOVING AVERAGE";
export const MOVING_AVERAGE_SHORT_LABEL = "1-HOUR MA";

/**
 * Parse a CSV timestamp to epoch milliseconds, or null.
 * "YYYY-MM-DD HH:MM[:SS]" is read as "YYYY-MM-DDTHH:MM[:SS]" so it parses the
 * same way in every browser (Safari rejects the space form).
 */
export function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(s)
    ? s.replace(" ", "T")
    : s;
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : ms;
}

export interface TimedValue {
  /** Epoch milliseconds, or null when the timestamp is missing/invalid. */
  t: number | null;
  /** The measurement, or null when missing/invalid. */
  value: number | null;
}

export interface MovingAveragePoint {
  avg: number | null;
  /** Number of valid readings that went into the average. */
  count: number;
}

const isValid = (v: number | null): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function movingAverage(
  points: readonly TimedValue[],
  windowMs: number = MOVING_AVERAGE_WINDOW_MS,
): MovingAveragePoint[] {
  // Valid readings, sorted by time, with prefix sums for O(log n) windows.
  const valid = points
    .filter(
      (p): p is { t: number; value: number } =>
        p.t !== null && Number.isFinite(p.t) && isValid(p.value),
    )
    .sort((a, b) => a.t - b.t);
  const times = valid.map((p) => p.t);
  const prefix = [0];
  for (const p of valid) prefix.push(prefix[prefix.length - 1]! + p.value);

  // First index with time > x.
  const upperBound = (x: number) => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  return points.map((p) => {
    if (p.t === null || !Number.isFinite(p.t)) return { avg: null, count: 0 };
    const start = upperBound(p.t - windowMs); // first reading strictly after t − window
    const end = upperBound(p.t); // one past the last reading at or before t
    const count = Math.max(0, end - start);
    if (count === 0) return { avg: null, count: 0 };
    return { avg: (prefix[end]! - prefix[start]!) / count, count };
  });
}

/** Median gap between consecutive valid timestamps, in ms (null if < 2). */
export function medianSamplingIntervalMs(
  times: readonly (number | null)[],
): number | null {
  const t = times.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (t.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) gaps.push(t[i]! - t[i - 1]!);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

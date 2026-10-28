/**
 * Units used by the safety configuration, and the only conversions allowed
 * between them. Anything not listed here is rejected rather than guessed.
 */
export const UNITS = [
  "ppm",
  "%vol",
  "%",
  "°C",
  "m/s",
  "m/min",
  "kPa",
  "ratio",
  "index",
  "boolean",
] as const;
export type Unit = (typeof UNITS)[number];

/** Multiply a value in `from` by this factor to get `to`. */
const FACTORS: Record<string, number> = {
  // 1 % by volume = 10 000 parts per million by volume.
  "%vol->ppm": 10_000,
  "ppm->%vol": 1 / 10_000,
  // 1 m/s = 60 m/min.
  "m/s->m/min": 60,
  "m/min->m/s": 1 / 60,
};

export function canConvert(from: string, to: string): boolean {
  return from === to || `${from}->${to}` in FACTORS;
}

/** Convert a value between units. Throws for unsupported pairs. */
export function convert(value: number, from: string, to: string): number {
  if (from === to) return value;
  const f = FACTORS[`${from}->${to}`];
  if (f === undefined) throw new Error(`No conversion from ${from} to ${to}.`);
  // Round away binary noise (e.g. 30/60) without changing meaningful digits.
  return Number((value * f).toPrecision(12));
}

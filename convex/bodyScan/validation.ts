// Sombrey Body Scan — Phase 5D: validation & calibration analysis.
//
// Compares scanner results (bodyScanMeasurements) with ground-truth
// measurements taken by hand (tape, stadiometer, scale) for tagged
// validation scans, and derives: per-measurement error statistics, test–retest
// repeatability and the minimum detectable change, calibration of the stated
// ±95 % ranges, a threshold operating curve, and breakdowns by depth source,
// distance, phone height, lighting, clothing and pose.
//
// Engineering tooling only (development deployments). Nothing here changes a
// measurement method or threshold: it produces the evidence for doing so in
// a NEW method version. Small samples are labelled "pilot" and statistics
// that need more data than exists are returned as null with the reason —
// never computed from too few observations.
//
// Pure — no I/O. Tested in tests/bodyScan/validation.test.ts.

import type { Measurement, MeasurementSet } from "./measurements.ts";

export const VALIDATION_ANALYSIS_VERSION = "v1";

// ─── Ground truth ─────────────────────────────────────────────────────────────

/** Hand-measured quantities → the scanner measurement they validate. */
export const TRUTH_MEASUREMENTS = {
  height: { scanner: "height", unit: "cm", range: [100, 250] },
  weight: { scanner: "weight", unit: "kg", range: [20, 400] },
  chest: { scanner: "chestCircumference", unit: "cm", range: [50, 200] },
  waist: { scanner: "waistCircumference", unit: "cm", range: [40, 200] },
  hips: { scanner: "hipCircumference", unit: "cm", range: [50, 200] },
  upperArm: { scanner: "upperArmCircumference", unit: "cm", range: [15, 70] },
  thigh: { scanner: "thighCircumference", unit: "cm", range: [25, 110] },
  calf: { scanner: "calfCircumference", unit: "cm", range: [20, 70] },
  shoulderWidth: { scanner: "shoulderWidth", unit: "cm", range: [25, 70] },
} as const satisfies Record<string, { scanner: string; unit: "cm" | "kg"; range: [number, number] }>;
export type TruthMeasurement = keyof typeof TRUTH_MEASUREMENTS;

/** Documented measuring protocols (docs/BODY_SCAN_5D.md §3). */
export const TRUTH_PROTOCOLS = [
  "stadiometer_barefoot",      // height: barefoot, heels/buttocks/back to the board, Frankfort plane, inhale
  "wall_mark_barefoot",        // height: same posture against a wall, flat-edge head marker, tape to floor
  "scale_calibrated_morning",  // weight: calibrated scale, minimal clothing, after voiding, before eating
  "tape_isak_style",           // circumferences: tape horizontal, relaxed, end of normal exhale, no compression
  "caliper_biacromial",        // shoulder width: acromion to acromion (a bone width, NOT the silhouette width)
  "tape_shoulder_silhouette",  // shoulder width across the widest point of the deltoids (silhouette-comparable)
] as const;
export const TRUTH_OPERATORS = ["self", "assistant", "clinician"] as const;
export const LENGTH_UNITS = { cm: 1, mm: 0.1, in: 2.54 } as const;
export const MASS_UNITS = { kg: 1, lb: 0.45359237 } as const;

export type TruthInput = {
  subjectCode: string;
  measuredAt: number;
  measurement: string;
  value: number;
  unit: string;
  protocol: string;
  operator: string;
  repeat: number;
};
export type Truth = Omit<TruthInput, "measurement" | "unit"> & { measurement: TruthMeasurement; unit: "cm" | "kg" };

export const SUBJECT_CODE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

/** Validates and converts one hand measurement to cm / kg. Refuses anything
 * implausible rather than storing it. */
export function normaliseTruth(t: TruthInput, now: number): { ok: true; truth: Truth } | { ok: false; error: string } {
  if (!SUBJECT_CODE.test(t.subjectCode)) return { ok: false, error: "Subject code: 1–12 capitals, digits or dashes (no names)" };
  const spec = (TRUTH_MEASUREMENTS as Record<string, (typeof TRUTH_MEASUREMENTS)[TruthMeasurement]>)[t.measurement];
  if (!spec) return { ok: false, error: "Unknown measurement" };
  if (!(TRUTH_PROTOCOLS as readonly string[]).includes(t.protocol)) return { ok: false, error: "Unknown protocol" };
  if (!(TRUTH_OPERATORS as readonly string[]).includes(t.operator)) return { ok: false, error: "Unknown operator" };
  if (!Number.isInteger(t.repeat) || t.repeat < 1 || t.repeat > 5) return { ok: false, error: "Repeat must be 1–5" };
  if (!Number.isFinite(t.measuredAt) || t.measuredAt > now + 60_000 || t.measuredAt < now - 365 * 86_400_000) return { ok: false, error: "Invalid date" };
  if (!Number.isFinite(t.value) || t.value <= 0) return { ok: false, error: "Value must be a positive number" };
  const factor = spec.unit === "kg"
    ? (MASS_UNITS as Record<string, number>)[t.unit]
    : (LENGTH_UNITS as Record<string, number>)[t.unit];
  if (factor === undefined) return { ok: false, error: `Unit must be ${spec.unit === "kg" ? "kg or lb" : "cm, mm or in"}` };
  const value = Math.round(t.value * factor * 100) / 100;
  if (value < spec.range[0] || value > spec.range[1]) return { ok: false, error: `Implausible ${t.measurement}: ${value} ${spec.unit}` };
  const heightProtocols = ["stadiometer_barefoot", "wall_mark_barefoot"];
  const ok =
    t.measurement === "height" ? heightProtocols.includes(t.protocol)
      : t.measurement === "weight" ? t.protocol === "scale_calibrated_morning"
        : t.measurement === "shoulderWidth" ? t.protocol === "caliper_biacromial" || t.protocol === "tape_shoulder_silhouette"
          : t.protocol === "tape_isak_style";
  if (!ok) return { ok: false, error: "That protocol doesn't apply to this measurement" };
  return { ok: true, truth: { ...t, measurement: t.measurement as TruthMeasurement, unit: spec.unit, value } };
}

// ─── Scan tags ────────────────────────────────────────────────────────────────

export const REPEAT_LABELS = ["A", "B", "C", "D", "E"] as const;     // A normal, B immediate repeat, C after repositioning the phone
export const PHONE_HEIGHTS = ["waist", "chest", "other"] as const;
export const LIGHTING = ["bright", "moderate", "dim"] as const;
export const CLOTHING = ["minimal", "fitted_athletic", "other"] as const;
export const POSES = ["ideal", "natural", "arms_close", "feet_moved", "torso_rotated"] as const;
export const DISTANCES_M = [1.0, 1.3, 1.5, 1.7, 2.0, 2.5] as const;

export type ScanTag = {
  subjectCode: string;
  session: string;           // groups repeats: same subject, same set-up, same day
  repeat: string;
  distanceM: number;         // tape-measured, camera → toes
  phoneHeight: string;
  lighting: string;
  clothing: string;
  pose: string;
};

export function validateTag(t: ScanTag): string | null {
  if (!SUBJECT_CODE.test(t.subjectCode)) return "Subject code: 1–12 capitals, digits or dashes (no names)";
  if (!/^[A-Za-z0-9-]{1,24}$/.test(t.session)) return "Session: 1–24 letters, digits or dashes";
  if (!(REPEAT_LABELS as readonly string[]).includes(t.repeat)) return "Repeat must be A–E";
  if (!Number.isFinite(t.distanceM) || t.distanceM < 0.5 || t.distanceM > 4) return "Distance must be 0.5–4 m";
  if (!(PHONE_HEIGHTS as readonly string[]).includes(t.phoneHeight)) return "Unknown phone height";
  if (!(LIGHTING as readonly string[]).includes(t.lighting)) return "Unknown lighting";
  if (!(CLOTHING as readonly string[]).includes(t.clothing)) return "Unknown clothing";
  if (!(POSES as readonly string[]).includes(t.pose)) return "Unknown pose";
  return null;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

/** Below this, a statistic isn't computed at all. */
export const MIN_N = { accuracy: 3, calibration: 5, quantile: 10, repeatDf: 2, iccSubjects: 5 } as const;
/** Below this, results are labelled pilot. */
export const PILOT_BELOW = 30;

const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Sample standard deviation (n − 1). */
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
/** Linear-interpolated quantile (type 7). */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export type ErrorPoint = { scanner: number; truth: number };
export type Pointwise = { absolute: number; signed: number; absolutePercent: number };

/** One comparison: |s − t|, s − t, |s − t| / t. */
export function pointError(p: ErrorPoint): Pointwise {
  const signed = p.scanner - p.truth;
  return { absolute: r(Math.abs(signed), 3), signed: r(signed, 3), absolutePercent: r((Math.abs(signed) / p.truth) * 100, 2) };
}

export type AccuracyStats = {
  n: number; pilot: boolean;
  mae: number; medianAbsolute: number; rmse: number; meanBias: number; sdError: number;
  limitsOfAgreement: [number, number]; mape: number;
};

/** Bland–Altman style accuracy; null below MIN_N.accuracy. */
export function accuracy(points: ErrorPoint[]): AccuracyStats | null {
  if (points.length < MIN_N.accuracy) return null;
  const e = points.map((p) => p.scanner - p.truth);
  const abs = e.map(Math.abs);
  const bias = mean(e), s = sd(e);
  return {
    n: points.length, pilot: points.length < PILOT_BELOW,
    mae: r(mean(abs)), medianAbsolute: r(median(abs)), rmse: r(Math.sqrt(mean(e.map((x) => x * x)))),
    meanBias: r(bias), sdError: r(s), limitsOfAgreement: [r(bias - 1.96 * s), r(bias + 1.96 * s)],
    mape: r(mean(points.map((p) => (Math.abs(p.scanner - p.truth) / p.truth) * 100))),
  };
}

export type RepeatGroup = { subject: string; values: number[] };
export type RepeatabilityStats = {
  groups: number; subjects: number; df: number; pilot: boolean;
  /** Within-subject SD = SEM = technical error of measurement. */
  withinSd: number; cvPercent: number;
  /** 1.96 × √2 × SEM: the smallest change distinguishable from noise (95 %). */
  mdc95: number;
  /** ICC(1,1), one-way random; null below MIN_N.iccSubjects subjects. */
  icc: number | null;
};

/** Test–retest from groups of repeated scans (same subject, same set-up). */
export function repeatability(groups: RepeatGroup[]): RepeatabilityStats | null {
  const g = groups.filter((x) => x.values.length >= 2);
  const df = g.reduce((a, x) => a + x.values.length - 1, 0);
  if (df < MIN_N.repeatDf) return null;
  const ssWithin = g.reduce((a, x) => { const m = mean(x.values); return a + x.values.reduce((b, v) => b + (v - m) ** 2, 0); }, 0);
  const msWithin = ssWithin / df;
  const withinSd = Math.sqrt(msWithin);
  const all = g.flatMap((x) => x.values);
  const grand = mean(all);
  const subjects = new Set(g.map((x) => x.subject)).size;
  let icc: number | null = null;
  if (subjects >= MIN_N.iccSubjects && g.length >= 2) {
    const k = all.length / g.length;
    const ssBetween = g.reduce((a, x) => a + x.values.length * (mean(x.values) - grand) ** 2, 0);
    const msBetween = ssBetween / (g.length - 1);
    icc = r((msBetween - msWithin) / (msBetween + (k - 1) * msWithin), 3);
  }
  return {
    groups: g.length, subjects, df, pilot: df < PILOT_BELOW,
    withinSd: r(withinSd, 3), cvPercent: r((withinSd / grand) * 100), mdc95: r(1.96 * Math.SQRT2 * withinSd), icc,
  };
}

export type CalibrationStats = {
  n: number; pilot: boolean;
  /** Share of results whose |error| was within the stated ±95 % range. */
  coverage: number;
  /** Rough 95 % interval for that share (normal approximation, clamped). */
  coverageInterval: [number, number];
  verdict: "consistent_with_95" | "ranges_too_narrow" | "ranges_too_wide";
  /** 95th percentile of |error| ÷ stated range: the factor the ranges would
   * need (null below MIN_N.quantile). Evidence for a new method, never applied here. */
  suggestedRangeMultiplier: number | null;
};

export function calibration(points: Array<ErrorPoint & { uncertainty: number }>): CalibrationStats | null {
  const p = points.filter((x) => x.uncertainty > 0);
  if (p.length < MIN_N.calibration) return null;
  const inside = p.filter((x) => Math.abs(x.scanner - x.truth) <= x.uncertainty).length;
  const cov = inside / p.length;
  const half = 1.96 * Math.sqrt((cov * (1 - cov)) / p.length) + 0.5 / p.length;
  const lo = Math.max(0, cov - half), hi = Math.min(1, cov + half);
  const verdict = hi < 0.95 ? "ranges_too_narrow" : lo > 0.99 ? "ranges_too_wide" : "consistent_with_95";
  const ratios = p.map((x) => Math.abs(x.scanner - x.truth) / x.uncertainty);
  return {
    n: p.length, pilot: p.length < PILOT_BELOW, coverage: r(cov, 3), coverageInterval: [r(lo, 3), r(hi, 3)], verdict,
    suggestedRangeMultiplier: p.length >= MIN_N.quantile ? r(quantile(ratios, 0.95), 2) : null,
  };
}

export type OperatingPoint = { maxRelativeRange: number; passing: number; passShare: number; mae: number | null; coverage: number | null };

/** What each candidate "available" threshold (stated 95 % range ÷ value)
 * would have let through, and how accurate those results really were. */
export function operatingCurve(points: Array<ErrorPoint & { uncertainty: number }>, thresholds: number[]): OperatingPoint[] {
  return thresholds.map((t) => {
    const pass = points.filter((p) => p.scanner > 0 && p.uncertainty / p.scanner <= t);
    return {
      maxRelativeRange: t, passing: pass.length, passShare: points.length ? r(pass.length / points.length, 3) : 0,
      mae: pass.length >= MIN_N.accuracy ? r(mean(pass.map((p) => Math.abs(p.scanner - p.truth)))) : null,
      coverage: pass.length >= MIN_N.calibration ? r(pass.filter((p) => Math.abs(p.scanner - p.truth) <= p.uncertainty).length / pass.length, 3) : null,
    };
  });
}

// ─── The report ───────────────────────────────────────────────────────────────

export type TaggedScan = {
  scanId: string;
  createdAt: number;
  deviceModel: string;
  depthSource: string;          // capture.depth ?? "none"
  tag: ScanTag;
  measurements: Pick<MeasurementSet, "methodVersion" | "measurements" | "scale"> | null;
};

export type Observation = {
  scanId: string; subject: string; session: string; repeat: string; measurement: TruthMeasurement;
  status: Measurement["status"] | "not_processed"; scanner: number | null; uncertainty: number | null; confidence: number | null;
  truth: number | null; truthRepeats: number;
  error: Pointwise | null;
  depthSource: string; deviceModel: string; distanceM: number; phoneHeight: string; lighting: string; clothing: string; pose: string;
  methodVersion: string | null; scaleOk: boolean; scaleReasons: string[];
};

/** Truth for a scan: the mean of that subject's repeats of the measurement
 * taken within `windowMs` of the scan (the same session). */
export function truthFor(truths: Truth[], subject: string, measurement: TruthMeasurement, at: number, windowMs = 36 * 3_600_000): { value: number; repeats: number; operatorSd: number | null } | null {
  const xs = truths.filter((t) => t.subjectCode === subject && t.measurement === measurement && Math.abs(t.measuredAt - at) <= windowMs).map((t) => t.value);
  if (!xs.length) return null;
  return { value: r(mean(xs), 2), repeats: xs.length, operatorSd: xs.length >= 2 ? r(sd(xs), 2) : null };
}

export function observations(scans: TaggedScan[], truths: Truth[]): Observation[] {
  const out: Observation[] = [];
  for (const s of scans) {
    for (const [name, spec] of Object.entries(TRUTH_MEASUREMENTS) as Array<[TruthMeasurement, (typeof TRUTH_MEASUREMENTS)[TruthMeasurement]]>) {
      const m = s.measurements?.measurements.find((x) => x.name === spec.scanner);
      const t = truthFor(truths, s.tag.subjectCode, name, s.createdAt);
      const scanner = m?.value ?? null;
      out.push({
        scanId: s.scanId, subject: s.tag.subjectCode, session: s.tag.session, repeat: s.tag.repeat, measurement: name,
        status: m?.status ?? "not_processed", scanner, uncertainty: m?.uncertainty ?? null, confidence: m?.confidence ?? null,
        truth: t?.value ?? null, truthRepeats: t?.repeats ?? 0,
        error: scanner !== null && t ? pointError({ scanner, truth: t.value }) : null,
        depthSource: s.depthSource, deviceModel: s.deviceModel, distanceM: s.tag.distanceM, phoneHeight: s.tag.phoneHeight,
        lighting: s.tag.lighting, clothing: s.tag.clothing, pose: s.tag.pose,
        methodVersion: s.measurements?.methodVersion ?? null, scaleOk: s.measurements?.scale.ok ?? false, scaleReasons: s.measurements?.scale.reasons ?? [],
      });
    }
  }
  return out;
}

export type MeasurementReport = {
  measurement: TruthMeasurement;
  scans: number;
  statusCounts: Record<string, number>;
  /** All results that carry a value (available + low confidence). */
  accuracyAll: AccuracyStats | null;
  /** Only results the method marked "available" — what a user would see. */
  accuracyAvailable: AccuracyStats | null;
  calibration: CalibrationStats | null;
  /** Repeats in the same session and set-up (A/B/…: capture variation). */
  repeatability: RepeatabilityStats | null;
  /** A vs B (immediate) and A/B vs C (phone repositioned): mean |difference|. */
  immediateRepeatMeanAbsDiff: number | null;
  repositionMeanAbsDiff: number | null;
  /** Tape repeat SD (operator variation) — the floor any scanner comparison inherits. */
  truthOperatorSd: number | null;
  operatingCurve: OperatingPoint[];
};

export const OPERATING_THRESHOLDS = [0.02, 0.025, 0.03, 0.04, 0.05, 0.07, 0.1, 0.15];

export function measurementReport(obs: Observation[], measurement: TruthMeasurement, truths: Truth[]): MeasurementReport {
  const o = obs.filter((x) => x.measurement === measurement);
  const statusCounts: Record<string, number> = {};
  for (const x of o) statusCounts[x.status] = (statusCounts[x.status] ?? 0) + 1;
  const withTruth = o.filter((x) => x.scanner !== null && x.truth !== null);
  const points = withTruth.map((x) => ({ scanner: x.scanner as number, truth: x.truth as number, uncertainty: x.uncertainty ?? 0 }));
  const available = withTruth.filter((x) => x.status === "available").map((x) => ({ scanner: x.scanner as number, truth: x.truth as number }));

  // Repeat groups: same subject + session + everything but the repeat label.
  const setup = (x: Observation) => [x.subject, x.session, x.distanceM, x.phoneHeight, x.lighting, x.clothing, x.pose, x.depthSource].join("|");
  const groups = new Map<string, Observation[]>();
  for (const x of o) if (x.scanner !== null) groups.set(setup(x), [...(groups.get(setup(x)) ?? []), x]);
  const rep = repeatability([...groups.values()].map((g) => ({ subject: g[0].subject, values: g.map((x) => x.scanner as number) })));

  // A vs B and A/B vs C within a subject + session (C may differ only by phone position).
  const bySession = new Map<string, Observation[]>();
  for (const x of o) if (x.scanner !== null) bySession.set(`${x.subject}|${x.session}`, [...(bySession.get(`${x.subject}|${x.session}`) ?? []), x]);
  const ab: number[] = [], abc: number[] = [];
  for (const g of bySession.values()) {
    const val = (l: string) => g.find((x) => x.repeat === l)?.scanner ?? null;
    const a = val("A"), b = val("B"), c = val("C");
    if (a !== null && b !== null) ab.push(Math.abs(a - b));
    if (c !== null && a !== null) abc.push(Math.abs(a - c));
    if (c !== null && b !== null) abc.push(Math.abs(b - c));
  }

  // Operator (tape) repeatability from repeated truth entries per subject/day.
  const tGroups = new Map<string, number[]>();
  for (const t of truths.filter((t) => t.measurement === measurement)) {
    const k = `${t.subjectCode}|${new Date(t.measuredAt).toISOString().slice(0, 10)}`;
    tGroups.set(k, [...(tGroups.get(k) ?? []), t.value]);
  }
  const tRep = repeatability([...tGroups.entries()].map(([k, values]) => ({ subject: k.split("|")[0], values })));

  return {
    measurement, scans: o.length, statusCounts,
    accuracyAll: accuracy(points), accuracyAvailable: accuracy(available),
    calibration: calibration(points.filter((p) => p.uncertainty > 0)),
    repeatability: rep,
    immediateRepeatMeanAbsDiff: ab.length ? r(mean(ab)) : null,
    repositionMeanAbsDiff: abc.length ? r(mean(abc)) : null,
    truthOperatorSd: tRep?.withinSd ?? null,
    operatingCurve: points.length ? operatingCurve(points, OPERATING_THRESHOLDS) : [],
  };
}

export type FactorLevel = { level: string; scans: number; metricScaleShare: number; heightMae: number | null; heightBias: number | null; waistMae: number | null };

/** How availability and error change with one capture factor. */
export function factorBreakdown(scans: TaggedScan[], obs: Observation[], factor: "depthSource" | "distanceM" | "phoneHeight" | "lighting" | "clothing" | "pose" | "deviceModel"): FactorLevel[] {
  const levelOf = (s: TaggedScan): string => {
    switch (factor) {
      case "depthSource": return s.depthSource;
      case "deviceModel": return s.deviceModel;
      case "distanceM": return s.tag.distanceM.toFixed(1);
      default: return s.tag[factor];
    }
  };
  const levels = new Map<string, TaggedScan[]>();
  for (const s of scans) levels.set(levelOf(s), [...(levels.get(levelOf(s)) ?? []), s]);
  return [...levels.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([level, ss]) => {
    const ids = new Set(ss.map((s) => s.scanId));
    const err = (m: TruthMeasurement) => obs.filter((x) => ids.has(x.scanId) && x.measurement === m && x.error).map((x) => x.error as Pointwise);
    const h = err("height"), w = err("waist");
    return {
      level, scans: ss.length,
      metricScaleShare: r(ss.filter((s) => s.measurements?.scale.ok).length / ss.length, 3),
      heightMae: h.length >= MIN_N.accuracy ? r(mean(h.map((e) => e.absolute))) : null,
      heightBias: h.length >= MIN_N.accuracy ? r(mean(h.map((e) => e.signed))) : null,
      waistMae: w.length >= MIN_N.accuracy ? r(mean(w.map((e) => e.absolute))) : null,
    };
  });
}

export type ValidationReport = {
  analysisVersion: string;
  pilot: true;
  scans: number;
  subjects: number;
  truths: number;
  methodVersions: string[];
  measurements: MeasurementReport[];
  factors: Record<string, FactorLevel[]>;
  scaleFailureReasons: Record<string, number>;
  notes: string[];
};

export function buildReport(scans: TaggedScan[], truths: Truth[]): { report: ValidationReport; observations: Observation[] } {
  const obs = observations(scans, truths);
  const scaleFailureReasons: Record<string, number> = {};
  for (const s of scans) if (s.measurements && !s.measurements.scale.ok) for (const reason of s.measurements.scale.reasons) scaleFailureReasons[reason] = (scaleFailureReasons[reason] ?? 0) + 1;
  const methods = [...new Set(scans.map((s) => s.measurements?.methodVersion).filter((x): x is string => !!x))].sort();
  const notes = [
    "Pilot validation: engineering evidence only — no accuracy claim may be made from it.",
    `Statistics need at least ${MIN_N.accuracy} paired results (accuracy), ${MIN_N.calibration} (calibration), ${MIN_N.quantile} (range multiplier), ${MIN_N.repeatDf} repeat degrees of freedom (repeatability) and ${MIN_N.iccSubjects} subjects (ICC); below that they're null.`,
    "Weight is never estimated by the scanner in method m1: its truth is recorded for future work only.",
    "Shoulder width: a biacromial (bone) caliper width is not the silhouette width — compare only tape_shoulder_silhouette entries for accuracy.",
  ];
  if (methods.length > 1) notes.push(`Results span method versions ${methods.join(", ")} — analyse each separately before drawing conclusions.`);
  return {
    report: {
      analysisVersion: VALIDATION_ANALYSIS_VERSION, pilot: true,
      scans: scans.length, subjects: new Set(scans.map((s) => s.tag.subjectCode)).size, truths: truths.length, methodVersions: methods,
      measurements: (Object.keys(TRUTH_MEASUREMENTS) as TruthMeasurement[]).map((m) => measurementReport(obs, m, truths)),
      factors: Object.fromEntries((["depthSource", "distanceM", "phoneHeight", "lighting", "clothing", "pose", "deviceModel"] as const).map((f) => [f, factorBreakdown(scans, obs, f)])),
      scaleFailureReasons,
      notes,
    },
    observations: obs,
  };
}

/** Observations as CSV for offline analysis (no names, no ids beyond the scan id). */
export function toCsv(obs: Observation[]): string {
  const cols = ["scanId", "subject", "session", "repeat", "measurement", "status", "scanner", "uncertainty", "confidence", "truth", "truthRepeats",
    "absError", "signedError", "absPercentError", "depthSource", "deviceModel", "distanceM", "phoneHeight", "lighting", "clothing", "pose", "methodVersion", "scaleOk", "scaleReasons"];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = obs.map((o) => [o.scanId, o.subject, o.session, o.repeat, o.measurement, o.status, o.scanner, o.uncertainty, o.confidence, o.truth, o.truthRepeats,
    o.error?.absolute, o.error?.signed, o.error?.absolutePercent, o.depthSource, o.deviceModel, o.distanceM, o.phoneHeight, o.lighting, o.clothing, o.pose,
    o.methodVersion, o.scaleOk, o.scaleReasons.join(";")].map(cell).join(","));
  return [cols.join(","), ...rows].join("\n");
}

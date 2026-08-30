/** Warmup curves (E02-067). Conservative / standard / aggressive. */
export interface WarmupPlanSeed {
  name: string;
  startPerDay: number;
  incrementWeek: number;
  plateau: number;
  minDomainAgeDays: number;
  maxBounceRate: number;
  maxDeferRate: number;
  maxComplaintRate: number;
  weekdayOnly: boolean;
  jitterPct: number;
}

export const WARMUP_PLANS: WarmupPlanSeed[] = [
  {
    name: "Conservative",
    startPerDay: 3, incrementWeek: 3, plateau: 30, minDomainAgeDays: 21,
    maxBounceRate: 0.02, maxDeferRate: 0.08, maxComplaintRate: 0.0005,
    weekdayOnly: true, jitterPct: 0.3,
  },
  {
    name: "Standard",
    startPerDay: 5, incrementWeek: 5, plateau: 40, minDomainAgeDays: 14,
    maxBounceRate: 0.03, maxDeferRate: 0.1, maxComplaintRate: 0.001,
    weekdayOnly: true, jitterPct: 0.25,
  },
  {
    // The ceiling, not a recommendation. The platform refuses anything steeper
    // than this regardless of plan (E06-057).
    name: "Aggressive",
    startPerDay: 8, incrementWeek: 8, plateau: 50, minDomainAgeDays: 14,
    maxBounceRate: 0.03, maxDeferRate: 0.12, maxComplaintRate: 0.001,
    weekdayOnly: false, jitterPct: 0.2,
  },
];

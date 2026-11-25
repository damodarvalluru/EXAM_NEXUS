import type { RiskLevel } from '@examnexus/shared';

export interface ScorableEvent {
  eventType: string;
  severity: string;
  riskWeight: number;
  serverTime: Date;
}

export interface RiskRule {
  rule: string;
  points: number;
  detail: string;
}

export interface RiskAssessmentResult {
  score: number;
  level: RiskLevel;
  rules: RiskRule[];
  modelVersion: string;
}

export const RISK_MODEL_VERSION = 'rule-correlation-v1';

const DEFAULT_WEIGHTS: Record<string, number> = {
  TAB_HIDDEN: 5,
  WINDOW_BLUR: 3,
  FULLSCREEN_EXIT: 8,
  DISCONNECTED: 2,
  RECONNECTED: 2,
  REPEATED_RECONNECT: 12,
  SCREEN_CAPTURE_SIGNAL: 15,
  MULTIPLE_SESSION: 30,
  SESSION_TOKEN_MISMATCH: 25,
  CLOCK_SKEW: 10,
  DEVICE_CHANGE: 20,
  SUSPICIOUS_INTERACTION: 6,
};

const SEVERITY_MULTIPLIER: Record<string, number> = {
  INFO: 1,
  LOW: 1,
  MEDIUM: 1.25,
  HIGH: 1.5,
  CRITICAL: 2,
};

const DEFAULT_THRESHOLDS = { low: 20, moderate: 40, high: 60, critical: 80 };

/** Read optional per-examination thresholds without trusting client input. */
export function parseThresholds(value: unknown): typeof DEFAULT_THRESHOLDS {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_THRESHOLDS;
  const record = value as Record<string, unknown>;
  const result = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100) {
      result[key] = candidate;
    }
  }
  // Keep thresholds monotonic even if an administrator supplied bad values.
  result.moderate = Math.max(result.moderate, result.low + 1);
  result.high = Math.max(result.high, result.moderate + 1);
  result.critical = Math.max(result.critical, result.high + 1);
  return result;
}

export function classify(score: number, thresholds = DEFAULT_THRESHOLDS): RiskLevel {
  if (score >= Math.min(100, thresholds.critical)) return 'CRITICAL';
  if (score >= Math.min(99, thresholds.high)) return 'HIGH';
  if (score >= Math.min(98, thresholds.moderate)) return 'MODERATE';
  if (score >= Math.min(97, thresholds.low)) return 'LOW';
  return 'NORMAL';
}

/**
 * Weighted, time-windowed rule scoring. A browser event is only a signal; a
 * high score creates an alert for human review and never auto-disqualifies a
 * candidate.
 */
export function assessRisk(events: ScorableEvent[], thresholds = DEFAULT_THRESHOLDS): RiskAssessmentResult {
  const now = Date.now();
  const windowStart = now - 5 * 60_000;
  const recent = events.filter((event) => event.serverTime.getTime() >= windowStart);
  const rules: RiskRule[] = [];
  let score = 0;

  for (const event of recent) {
    const base = event.riskWeight > 0 ? event.riskWeight : (DEFAULT_WEIGHTS[event.eventType] ?? 4);
    const multiplier = SEVERITY_MULTIPLIER[event.severity] ?? 1;
    const points = Math.round(base * multiplier * 100) / 100;
    score += points;
    rules.push({
      rule: `event:${event.eventType}`,
      points,
      detail: 'Configured event weight multiplied by event severity',
    });
  }

  const counts = new Map<string, number>();
  for (const event of recent) counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  for (const [eventType, count] of counts) {
    if (count >= 3) {
      const points = (count - 2) * 5;
      score += points;
      rules.push({ rule: `repeat:${eventType}`, points, detail: `${count} events in a five-minute window` });
    }
  }
  if (counts.size >= 3) {
    score += 8;
    rules.push({ rule: 'distinct-categories', points: 8, detail: `${counts.size} distinct event types in a five-minute window` });
  }

  score = Math.min(100, Math.round(score * 100) / 100);
  return { score, level: classify(score, thresholds), rules, modelVersion: RISK_MODEL_VERSION };
}

export function defaultEventWeight(eventType: string): number {
  return DEFAULT_WEIGHTS[eventType] ?? 4;
}

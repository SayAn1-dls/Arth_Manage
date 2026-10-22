import { Decimal } from 'decimal.js';

/**
 * The scoring engine (PRD Module E.1). Pure functions, exact decimal arithmetic, no intermediate rounding.
 *
 *   n_i = s_i / max_i          a criterion score as a fraction of its maximum
 *   J   = Σ w_i · n_i          one judge's weighted score, 0..100 (weights total exactly 100)
 *   T   = mean of counted J    the team's score for the round
 *
 * Stored and compared values are rounded half-up to 4 decimal places; screens show 2.
 * Nothing is normalised across judges and no missing score is ever filled in.
 */
export interface ScoringCriterion {
  id: string;
  weight: number;
  min: number;
  max: number;
}

export type Scores = Record<string, number>;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SCORE_DP = 4;

/** Round half-up to the stored precision (4 dp). */
export function toStored(value: Decimal): Decimal {
  return value.toDecimalPlaces(SCORE_DP, Decimal.ROUND_HALF_UP);
}

export function weightsTotal(criteria: Pick<ScoringCriterion, 'weight'>[]): number {
  return criteria.reduce((sum, c) => sum + c.weight, 0);
}

export interface ScoreValidation {
  ok: boolean;
  /** criterionId -> message, e.g. "Enter a whole number from 1 to 10" */
  errors: Record<string, string>;
  /** Criteria that have no score yet. */
  missing: string[];
}

/** Every criterion is required, and each score must be a whole number inside [min, max] (PRD FR-144, FR-145). */
export function validateScores(
  criteria: ScoringCriterion[],
  scores: Record<string, unknown>,
): ScoreValidation {
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  for (const c of criteria) {
    const v = scores[c.id];
    if (v === undefined || v === null || v === '') {
      missing.push(c.id);
      errors[c.id] = `Enter a whole number from ${c.min} to ${c.max}`;
    } else if (typeof v !== 'number' || !Number.isInteger(v) || v < c.min || v > c.max) {
      errors[c.id] = `Enter a whole number from ${c.min} to ${c.max}`;
    }
  }
  for (const key of Object.keys(scores)) {
    if (!criteria.some((c) => c.id === key))
      errors[key] = 'This criterion is not part of the rubric';
  }
  return { ok: Object.keys(errors).length === 0, errors, missing };
}

/** J, unrounded. Throws unless the scores are complete and valid, so no partial score can ever be averaged in. */
export function judgeScoreExact(criteria: ScoringCriterion[], scores: Scores): Decimal {
  const check = validateScores(criteria, scores);
  if (!check.ok) throw new Error('Cannot compute a judge score from incomplete or invalid scores');
  if (weightsTotal(criteria) !== 100) throw new Error('Rubric weights must total exactly 100');
  return criteria.reduce(
    (sum, c) => sum.plus(new Decimal(c.weight).times(new Decimal(scores[c.id]!).div(c.max))),
    new Decimal(0),
  );
}

/** J as stored with the evaluation (4 dp). */
export function judgeScore(criteria: ScoringCriterion[], scores: Scores): Decimal {
  return toStored(judgeScoreExact(criteria, scores));
}

/** T: the plain mean of the counted evaluations' exact J values, stored at 4 dp. */
export function teamScore(
  evaluations: { criteria: ScoringCriterion[]; scores: Scores }[],
): Decimal | null {
  if (evaluations.length === 0) return null;
  const total = evaluations.reduce(
    (sum, e) => sum.plus(judgeScoreExact(e.criteria, e.scores)),
    new Decimal(0),
  );
  return toStored(total.div(evaluations.length));
}

/** Rubric structure rules, one specific message per rule (PRD FR-142, FR-143). Drafts may be saved invalid. */
export interface RubricCriterionInput {
  name: string;
  weight: number;
  min: number;
  max: number;
}

export const MAX_CRITERIA = 12;

export function validateRubricStructure(criteria: RubricCriterionInput[]): string[] {
  const problems: string[] = [];
  if (criteria.length === 0) problems.push('Add at least one criterion');
  if (criteria.length > MAX_CRITERIA)
    problems.push(`A rubric can have at most ${MAX_CRITERIA} criteria`);
  const names = new Set<string>();
  for (const c of criteria) {
    const label = c.name || 'A criterion';
    if (!c.name.trim()) problems.push('Every criterion needs a name');
    else if (names.has(c.name.trim().toLowerCase()))
      problems.push(`"${c.name}" is used more than once`);
    names.add(c.name.trim().toLowerCase());
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)
      problems.push(`${label}: weight must be a whole number from 1 to 100`);
    if (c.min !== 0 && c.min !== 1) problems.push(`${label}: the lowest score must be 0 or 1`);
    if (!Number.isInteger(c.max) || c.max <= c.min || c.max > 100)
      problems.push(
        `${label}: the highest score must be a whole number above ${c.min} and at most 100`,
      );
  }
  const total = weightsTotal(criteria);
  if (criteria.length > 0 && total !== 100)
    problems.push(`Weights total ${total}%. They must total 100% to activate`);
  return problems;
}

export { Decimal };

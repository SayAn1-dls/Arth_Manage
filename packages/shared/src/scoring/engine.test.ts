import { describe, expect, it } from 'vitest';
import {
  Decimal,
  judgeScore,
  judgeScoreExact,
  teamScore,
  toStored,
  validateRubricStructure,
  validateScores,
  weightsTotal,
  type ScoringCriterion,
} from './engine.js';
import { rankTeams } from './ranking.js';
import { RUBRIC_TEMPLATES } from './templates.js';

// PRD E.1 worked example: weights 30/40/30, ranges 1-10, 1-10, 0-5.
const criteria: ScoringCriterion[] = [
  { id: 'A', weight: 30, min: 1, max: 10 },
  { id: 'B', weight: 40, min: 1, max: 10 },
  { id: 'C', weight: 30, min: 0, max: 5 },
];

describe('worked example (PRD E.1, AT-14)', () => {
  it('computes J for each judge exactly', () => {
    expect(judgeScore(criteria, { A: 8, B: 7, C: 4 }).toFixed(4)).toBe('76.0000');
    expect(judgeScore(criteria, { A: 6, B: 9, C: 3 }).toFixed(4)).toBe('72.0000');
  });
  it('computes T as the plain mean of the counted evaluations', () => {
    const t = teamScore([
      { criteria, scores: { A: 8, B: 7, C: 4 } },
      { criteria, scores: { A: 6, B: 9, C: 3 } },
    ]);
    expect(t?.toFixed(4)).toBe('74.0000');
  });
  it('a missing evaluation (draft) is simply not passed in, so T is unchanged', () => {
    const counted = [
      { criteria, scores: { A: 8, B: 7, C: 4 } },
      { criteria, scores: { A: 6, B: 9, C: 3 } },
    ];
    expect(teamScore(counted)?.toFixed(4)).toBe('74.0000');
    expect(teamScore([])).toBeNull();
  });
});

describe('exactness and rounding', () => {
  it('uses exact decimals with no intermediate rounding, then rounds half-up to 4 dp', () => {
    const c: ScoringCriterion[] = [{ id: 'x', weight: 100, min: 1, max: 3 }];
    expect(judgeScoreExact(c, { x: 1 }).toString()).toBe(
      '33.33333333333333333333333333333333333333',
    );
    expect(judgeScore(c, { x: 1 }).toFixed(4)).toBe('33.3333');
    expect(judgeScore(c, { x: 2 }).toFixed(4)).toBe('66.6667');
  });
  it('rounds exactly half up at the fifth decimal', () => {
    expect(toStored(new Decimal('12.34565')).toFixed(4)).toBe('12.3457');
    expect(toStored(new Decimal('12.34564999')).toFixed(4)).toBe('12.3456');
  });
  it('does not round J before averaging', () => {
    const c: ScoringCriterion[] = [{ id: 'x', weight: 100, min: 1, max: 3 }];
    // J values 33.3333.. and 100: mean of exact values is 66.66666.. -> 66.6667, not (33.3333 + 100) / 2 = 66.66665
    expect(
      teamScore([
        { criteria: c, scores: { x: 1 } },
        { criteria: c, scores: { x: 3 } },
      ])?.toFixed(4),
    ).toBe('66.6667');
  });
});

describe('score validation (FR-144, FR-145, AT-14N)', () => {
  it('rejects out-of-range, fractional, non-numeric and unknown scores with a clear message', () => {
    const v = validateScores(criteria, { A: 11, B: 7.5, C: '3' as unknown as number, Z: 1 });
    expect(v.ok).toBe(false);
    expect(v.errors.A).toBe('Enter a whole number from 1 to 10');
    expect(v.errors.B).toBe('Enter a whole number from 1 to 10');
    expect(v.errors.C).toBe('Enter a whole number from 0 to 5');
    expect(v.errors.Z).toBeDefined();
  });
  it('lists blank criteria as missing and never computes a partial score', () => {
    const v = validateScores(criteria, { A: 5 });
    expect(v.missing).toEqual(['B', 'C']);
    expect(() => judgeScoreExact(criteria, { A: 5 })).toThrow();
  });
  it('accepts the boundaries', () => {
    expect(validateScores(criteria, { A: 1, B: 10, C: 0 }).ok).toBe(true);
  });
  it('refuses to compute when weights do not total 100', () => {
    expect(() => judgeScoreExact([{ id: 'a', weight: 90, min: 1, max: 10 }], { a: 5 })).toThrow(
      /total exactly 100/,
    );
  });
});

describe('rubric structure (FR-142, FR-143, AT-12)', () => {
  const good = [
    { name: 'Idea', weight: 60, min: 1, max: 10 },
    { name: 'Build', weight: 40, min: 0, max: 5 },
  ];
  it('accepts a valid rubric', () => expect(validateRubricStructure(good)).toEqual([]));
  it('names the exact weight problem', () => {
    expect(
      validateRubricStructure([
        { name: 'A', weight: 50, min: 1, max: 10 },
        { name: 'B', weight: 45, min: 1, max: 10 },
      ]),
    ).toContain('Weights total 95%. They must total 100% to activate');
  });
  it('rejects min other than 0 or 1, max not above min, duplicates and empty rubrics', () => {
    const problems = validateRubricStructure([
      { name: 'A', weight: 50, min: 2, max: 10 },
      { name: 'a', weight: 50, min: 1, max: 1 },
    ]);
    expect(problems.join('|')).toMatch(/lowest score must be 0 or 1/);
    expect(problems.join('|')).toMatch(/highest score must be a whole number above 1/);
    expect(problems.join('|')).toMatch(/used more than once/);
    expect(validateRubricStructure([])).toContain('Add at least one criterion');
  });
  it('limits a rubric to 12 criteria', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      name: `C${i}`,
      weight: 1,
      min: 1,
      max: 10,
    }));
    expect(validateRubricStructure(many).join('|')).toMatch(/at most 12/);
  });
  it('ships templates that activate without edits (FR-141)', () => {
    for (const t of RUBRIC_TEMPLATES) {
      expect(validateRubricStructure(t.criteria)).toEqual([]);
      expect(weightsTotal(t.criteria)).toBe(100);
      expect(t.criteria.every((c) => c.description.length > 0)).toBe(true);
    }
  });
});

describe('ranking (FR-150, FR-151)', () => {
  const d = (s: string) => new Decimal(s);
  it('uses standard competition ranking and flags ties without breaking them', () => {
    const r = rankTeams([
      { teamId: 'a', score: d('80.1234'), group: 'all' },
      { teamId: 'b', score: d('80.1234'), group: 'all' },
      { teamId: 'c', score: d('79'), group: 'all' },
    ]);
    expect(r.map((x) => [x.teamId, x.rank, x.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false],
    ]);
  });
  it('ranks per group independently', () => {
    const r = rankTeams([
      { teamId: 'a', score: d('50'), group: 'fintech' },
      { teamId: 'b', score: d('90'), group: 'climate' },
      { teamId: 'c', score: d('60'), group: 'fintech' },
    ]);
    expect(r.find((x) => x.teamId === 'c')?.rank).toBe(1);
    expect(r.find((x) => x.teamId === 'b')?.rank).toBe(1);
    expect(r.find((x) => x.teamId === 'a')?.rank).toBe(2);
  });
});

import { request } from './api.js';

export interface RubricCriterionDto {
  id: string;
  name: string;
  description: string;
  weight: number;
  min: number;
  max: number;
  order?: number;
}
export interface RubricDto {
  id: string;
  name: string;
  state: 'DRAFT' | 'ACTIVE' | 'LOCKED';
  teamCommentMode: 'OFF' | 'OPTIONAL' | 'REQUIRED';
  sourceTemplate: string | null;
  structureVersion: number;
  criteria: RubricCriterionDto[];
  problems: string[];
}
export interface TemplateDto {
  key: 'HACKATHON' | 'CASE_COMPETITION';
  name: string;
  criteria: Omit<RubricCriterionDto, 'id'>[];
}

export type EvalStatus =
  'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'REOPENED' | 'NOT_REQUIRED' | 'CONFLICT';

export interface OverviewAssignment {
  id: string;
  judgeMembershipId: string;
  judgeName: string;
  status: 'ACTIVE' | 'CONFLICT' | 'EXCLUDED' | 'UNASSIGNED';
  reason: string | null;
  conflictDeclaredBy: string | null;
  evaluation: {
    status: 'DRAFT' | 'SUBMITTED' | 'REOPENED';
    correctionRequested: boolean;
    correctionReason: string | null;
  } | null;
}
export interface JudgingOverview {
  round: {
    id: string;
    name: string;
    judgingStatus: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
    requiredEvaluations: number;
    judgingDeadline: string | null;
  };
  rubric: { state: 'DRAFT' | 'ACTIVE' | 'LOCKED'; criteria: number } | null;
  canOpen: boolean;
  judges: {
    membershipId: string;
    name: string;
    email: string;
    assigned: number;
    submitted: number;
    drafts: number;
  }[];
  teams: {
    teamId: string;
    teamCode: string;
    name: string;
    disqualified: boolean;
    submitted: boolean;
    required: number;
    counted: number;
    complete: boolean;
    assignments: OverviewAssignment[];
  }[];
  missing: {
    teamId: string;
    teamCode: string;
    name: string;
    counted: number;
    required: number;
    shortfall: number;
  }[];
  judgesAtRisk: string[];
}

export interface JudgeRound {
  roundId: string;
  name: string;
  order: number;
  judgingStatus: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  judgingDeadline: string | null;
  assigned: number;
  submitted: number;
  rubricState: string | null;
}
export interface JudgeTeamRow {
  starred?: boolean;
  assignmentId: string;
  teamId: string;
  teamCode: string;
  name: string;
  trackId: string | null;
  trackName: string;
  problemTitle: string;
  disqualified: boolean;
  submission: 'SUBMITTED' | 'LATE' | 'DID_NOT_SUBMIT';
  evaluationStatus: EvalStatus;
  assignmentStatus: string;
}

export interface Workspace {
  assignmentId: string;
  assignmentStatus: string;
  conflictReason: string | null;
  team: { id: string; teamCode: string; name: string };
  round: { id: string; name: string; judgingStatus: 'NOT_OPEN' | 'OPEN' | 'CLOSED' };
  prevTeamId: string | null;
  nextTeamId: string | null;
  locked?: string | null;
  members?: { name: string; institution: string }[];
  track?: string | null;
  problem?: { title: string; description: string } | null;
  submission?: {
    versionNo: number;
    submittedAt: string;
    lateMinutes: number;
    title: string;
    summary: string;
    fields: {
      id: string;
      label: string;
      type: string;
      value: string;
      file: { id: string; name: string; size: number; contentType: string } | null;
    }[];
  } | null;
  rubric?: {
    teamCommentMode: 'OFF' | 'OPTIONAL' | 'REQUIRED';
    criteria: RubricCriterionDto[];
  } | null;
  evaluation?: {
    status: 'DRAFT' | 'SUBMITTED' | 'REOPENED';
    version: number;
    scores: Record<string, number>;
    teamComment: string;
    privateNote: string;
    weightedScore: string | null;
    submittedAt: string | null;
    correctionRequested: boolean;
    correctionReason: string | null;
    correctionDeclinedReason: string | null;
  } | null;
  editable?: boolean;
  notEditableReason?: string | null;
}

export interface EvaluationRow {
  assignmentId: string;
  assignmentStatus: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  judgeName: string;
  status: string;
  weightedScore: string | null;
  scores: Record<string, number>;
  teamComment: string | null;
  privateNote: string | null;
  submittedAt: string | null;
  versions: number;
  correctionRequested: boolean;
  correctionReason: string | null;
}

const r = (eventId: string, roundId: string) => `/events/${eventId}/rounds/${roundId}`;

export const judgingApi = {
  templates: (e: string, round: string) =>
    request<{ templates: TemplateDto[] }>('GET', `${r(e, round)}/templates`).then(
      (x) => x.templates,
    ),
  rubric: (e: string, round: string) =>
    request<{ rubric: RubricDto | null }>('GET', `${r(e, round)}/rubric`).then((x) => x.rubric),
  applyTemplate: (e: string, round: string, key: string) =>
    request<{ rubric: RubricDto }>('POST', `${r(e, round)}/rubric/template`, { key }),
  saveRubric: (e: string, round: string, body: unknown) =>
    request<{ rubric: RubricDto }>('PUT', `${r(e, round)}/rubric`, body),
  rubricAction: (
    e: string,
    round: string,
    action: 'activate' | 'deactivate' | 'unlock',
    body?: unknown,
  ) =>
    request<{ rubric: RubricDto; reopened?: number }>(
      'POST',
      `${r(e, round)}/rubric/${action}`,
      body,
    ),
  setStatus: (e: string, round: string, status: string) =>
    request<{ judgingStatus: string }>('PUT', `${r(e, round)}/judging`, { status }),
  overview: (e: string, round: string) =>
    request<JudgingOverview>('GET', `${r(e, round)}/judging/overview`),
  assign: (e: string, round: string, body: unknown) =>
    request<{
      created: number;
      restored: number;
      alreadyAssigned: number;
      skippedDisqualified: string[];
    }>('POST', `${r(e, round)}/assignments`, body),
  autoBalance: (e: string, round: string, judgeMembershipIds: string[]) =>
    request<{ created: number }>('POST', `${r(e, round)}/assignments/auto-balance`, {
      judgeMembershipIds,
    }),
  unassign: (e: string, id: string, confirm: boolean) =>
    request<void>('DELETE', `/events/${e}/assignments/${id}${confirm ? '?confirm=1' : ''}`),
  assignmentAction: (e: string, id: string, action: string, body?: unknown) =>
    request<{ ok: true }>('POST', `/events/${e}/assignments/${id}/${action}`, body),
  evaluations: (e: string, round: string) =>
    request<{
      criteria: { id: string; name: string; weight: number; min: number; max: number }[];
      evaluations: EvaluationRow[];
    }>('GET', `${r(e, round)}/evaluations`),
  judgeRounds: (e: string) =>
    request<{ rounds: JudgeRound[] }>('GET', `/events/${e}/judge/rounds`).then((x) => x.rounds),
  judgeTeams: (e: string, round: string, qs: string) =>
    request<{
      round: { id: string; name: string; judgingStatus: string; judgingDeadline: string | null };
      total: number;
      rows: JudgeTeamRow[];
    }>('GET', `${r(e, round)}/judge/teams?${qs}`),
  workspace: (e: string, round: string, team: string) =>
    request<Workspace>('GET', `${r(e, round)}/judge/teams/${team}`),
  saveEvaluation: (e: string, assignmentId: string, body: unknown) =>
    request<{ version: number; status: string }>(
      'PUT',
      `/events/${e}/assignments/${assignmentId}/evaluation`,
      body,
    ),
  submitEvaluation: (e: string, assignmentId: string, version: number) =>
    request<{ weightedScore: string; submittedAt: string; version: number }>(
      'POST',
      `/events/${e}/assignments/${assignmentId}/evaluation/submit`,
      { version },
    ),
  reportFile: (e: string, round: string, team: string, description: string) =>
    request<{ id: string }>('POST', `${r(e, round)}/judge/teams/${team}/report-file`, {
      description,
    }),
  evaluationAction: (e: string, assignmentId: string, action: string, reason: string) =>
    request<{ ok: true }>('POST', `/events/${e}/assignments/${assignmentId}/evaluation/${action}`, {
      reason,
    }),
};

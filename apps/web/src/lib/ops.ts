import { request } from './api.js';

export interface ReviewResult {
  teamId: string;
  teamCode: string;
  name: string;
  trackName: string;
  group: string;
  state: 'RANKED' | 'DISQUALIFIED' | 'DID_NOT_SUBMIT' | 'NOT_RANKED' | 'NO_EVALUATIONS';
  reason: string | null;
  counted: number;
  required: number;
  complete: boolean;
  pending: number;
  score: string | null;
  rank: number | null;
  tied: boolean;
  tieResolved: boolean;
  needsResolution: boolean;
  breakdown: {
    assignmentId: string;
    judgeName: string;
    weightedScore: string;
    scores: Record<string, number>;
  }[];
  excluded: { assignmentId: string; judgeName: string; status: string; reason: string | null }[];
}
export interface ResultsReviewDto {
  round: {
    id: string;
    name: string;
    judgingStatus: string;
    awardPositions: number;
    rankingScope: string;
    requiredEvaluations: number;
  };
  criteria: { id: string; name: string; weight: number; max: number }[];
  results: ReviewResult[];
  checklist: {
    judgingClosed: boolean;
    hasRubric: boolean;
    missing: {
      teamId: string;
      teamCode: string;
      name: string;
      counted: number;
      required: number;
      pending: number;
    }[];
    unresolvedTies: { group: string; rank: number; teams: { teamId: string; name: string }[] }[];
  };
  canApprove: boolean;
  approvedVersion: number | null;
  published: number | null;
  snapshots: {
    id: string;
    versionNo: number;
    status: string;
    approvedAt: string;
    invalidatedAt: string | null;
    invalidatedReason: string | null;
    publishedAt: string | null;
    unpublishedAt: string | null;
  }[];
  ties: {
    id: string;
    group: string;
    rank: number;
    teamIds: string[];
    mode: string;
    order: string[];
    reason: string;
  }[];
  notRanked: { teamId: string; reason: string }[];
}
export interface PublishedRound {
  roundId: string;
  roundName: string;
  versionNo: number;
  publishedAt: string;
  updated: boolean;
  scope: string;
  awardPositions: number;
  winners: { rank: number; teamCode: string; name: string; group: string }[] | null;
  own: {
    teamCode: string;
    name: string;
    ranked: boolean;
    rank: number | null;
    score: string | null;
    notRanked: boolean;
  } | null;
}

export interface StaffTask {
  id: string;
  title: string;
  description: string | null;
  type: 'CHECKIN' | 'VERIFICATION' | 'GENERAL';
  dueAt: string | null;
  location: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
  note: string | null;
  statusChangedBy: string | null;
  statusChangedAt: string;
  overdue: boolean;
  assignees: { membershipId: string; name: string | null }[];
  teams: { id: string; teamCode: string; name: string }[];
}
export interface CheckInCard {
  teamId: string;
  teamCode: string;
  name: string;
  track: string | null;
  disqualified: boolean;
  status: 'NOT_CHECKED_IN' | 'PARTIAL' | 'CHECKED_IN';
  members: {
    membershipId: string;
    name: string;
    institution: string;
    yearOfStudy: string;
    checkedIn: boolean;
    checkedInAt: string | null;
    checkedInBy: string | null;
    idVerified: boolean;
    idVerifiedBy: string | null;
    note: string | null;
    canUndo: boolean;
  }[];
}
export interface Issue {
  id: string;
  category: string;
  description: string;
  severity: 'NORMAL' | 'URGENT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  resolutionNote: string | null;
  createdAt: string;
  reporter: string;
  reporterRole: string | null;
  team: { id: string; teamCode: string; name: string } | null;
}
export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}

type Card<T> = T | { error: string };
export interface Dashboard {
  generatedAt: string;
  participants: Card<{
    registered: number;
    inTeam: number;
    noTeam: number;
    withdrawn: number;
    registration: string;
  }>;
  teams: Card<{ total: number; complete: number; incomplete: number; disqualified: number }>;
  submissions: Card<{ roundId: string; name: string; counts: Record<string, number> }[]>;
  judging: Card<
    {
      roundId: string;
      name: string;
      status: string;
      assigned: number;
      submitted: number;
      teamsWithWork: number;
    }[]
  >;
  checkin: Card<{
    participants: number;
    checkedIn: number;
    idVerified: number;
    teams: { total: number; checkedIn: number; partial: number; notCheckedIn: number };
  }>;
  issues: Card<{ open: number; urgent: { id: string; category: string; description: string }[] }>;
  tasks: Card<{ blocked: number; open: number; unassigned: number }>;
  deadlines: Card<{ label: string; at: string }[]>;
  integrations: Card<{
    configured: boolean;
    status: 'NOT_CONNECTED' | 'CONNECTED' | 'FAILING' | 'NEEDS_REAUTH';
    driveEnabled: boolean;
    lastSuccessAt: string | null;
    lastError: string | null;
    spreadsheetUrl: string | null;
  }>;
}

const e = (id: string) => `/events/${id}`;
export const opsApi = {
  review: (ev: string, round: string) =>
    request<ResultsReviewDto>('GET', `${e(ev)}/rounds/${round}/results/review`),
  putTie: (ev: string, round: string, body: unknown) =>
    request('PUT', `${e(ev)}/rounds/${round}/results/ties`, body),
  deleteTie: (ev: string, round: string, id: string) =>
    request('DELETE', `${e(ev)}/rounds/${round}/results/ties/${id}`),
  putNotRanked: (ev: string, round: string, body: unknown) =>
    request('PUT', `${e(ev)}/rounds/${round}/results/not-ranked`, body),
  deleteNotRanked: (ev: string, round: string, teamId: string) =>
    request('DELETE', `${e(ev)}/rounds/${round}/results/not-ranked/${teamId}`),
  approve: (ev: string, round: string) =>
    request<{ versionNo: number }>('POST', `${e(ev)}/rounds/${round}/results/approve`),
  publish: (ev: string, round: string) =>
    request<{ versionNo: number }>('POST', `${e(ev)}/rounds/${round}/results/publish`),
  unpublish: (ev: string, round: string, reason: string) =>
    request('POST', `${e(ev)}/rounds/${round}/results/unpublish`, { reason }),
  published: (ev: string) =>
    request<{
      rounds: PublishedRound[];
      visibility: { winners: boolean; ownRank: boolean; ownScores: boolean };
    }>('GET', `${e(ev)}/results`),
  tasks: (ev: string, status = '') =>
    request<{ tasks: StaffTask[] }>(
      'GET',
      `${e(ev)}/staff/tasks${status ? `?status=${status}` : ''}`,
    ).then((r) => r.tasks),
  createTask: (ev: string, body: unknown) =>
    request<StaffTask>('POST', `${e(ev)}/staff/tasks`, body),
  updateTask: (ev: string, id: string, body: unknown) =>
    request<StaffTask>('PATCH', `${e(ev)}/staff/tasks/${id}`, body),
  deleteTask: (ev: string, id: string) => request<void>('DELETE', `${e(ev)}/staff/tasks/${id}`),
  taskStatus: (ev: string, id: string, status: string, note?: string) =>
    request<StaffTask>('PUT', `${e(ev)}/staff/tasks/${id}/status`, { status, note }),
  checkinSearch: (ev: string, q: string) =>
    request<{ teams: CheckInCard[] }>(
      'GET',
      `${e(ev)}/checkin/teams?q=${encodeURIComponent(q)}`,
    ).then((r) => r.teams),
  checkinSummary: (ev: string) =>
    request<{
      participants: number;
      checkedIn: number;
      idVerified: number;
      teams: { total: number; checkedIn: number; partial: number; notCheckedIn: number };
    }>('GET', `${e(ev)}/checkin/summary`),
  checkinAction: (
    ev: string,
    membershipId: string,
    action: 'check_in' | 'undo' | 'verify',
    note?: string,
  ) => request<CheckInCard>('POST', `${e(ev)}/checkin/members/${membershipId}`, { action, note }),
  issues: (ev: string, status = '') =>
    request<{ issues: Issue[] }>('GET', `${e(ev)}/issues${status ? `?status=${status}` : ''}`).then(
      (r) => r.issues,
    ),
  reportIssue: (ev: string, body: unknown) => request<Issue>('POST', `${e(ev)}/issues`, body),
  escalate: (ev: string, id: string) => request<Issue>('POST', `${e(ev)}/issues/${id}/escalate`),
  issueStatus: (ev: string, id: string, status: string, resolutionNote?: string) =>
    request<Issue>('PUT', `${e(ev)}/issues/${id}/status`, { status, resolutionNote }),
  dashboard: (ev: string) => request<Dashboard>('GET', `${e(ev)}/dashboard`),
  audit: (ev: string, qs: string) =>
    request<{
      total: number;
      page: number;
      pageSize: number;
      rows: AuditRow[];
      entityTypes: string[];
    }>('GET', `${e(ev)}/audit?${qs}`),
};

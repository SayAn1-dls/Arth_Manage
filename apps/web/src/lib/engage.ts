import { request } from './api.js';
import type { CertType, FeedbackQuestion } from '@arthakram/shared';

export type Audience = 'PARTICIPANT' | 'JUDGE';

export interface FeedbackFormDto {
  audience: Audience;
  state: 'DRAFT' | 'OPEN' | 'CLOSED';
  confidential: boolean;
  closeAt: string | null;
  version: number;
  questions: FeedbackQuestion[];
  responses: number;
  eligible: number;
}
export interface FeedbackAggregate {
  audience: Audience;
  confidential: boolean;
  eligible: number;
  responses: number;
  rate: number;
  questions: {
    id: string;
    text: string;
    type: FeedbackQuestion['type'];
    count: number;
    average?: number | null;
    distribution?: number[];
    counts?: Record<string, number>;
    answers?: string[];
  }[];
}
export interface MyFeedback {
  audience: Audience;
  available: boolean;
  open: boolean;
  closed: boolean;
  submitted: boolean;
  submittedAt: string | null;
  confidential: boolean;
  questions: FeedbackQuestion[];
}
export interface CommentRow {
  evaluationId: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  judgeName: string;
  comment: string;
  hiddenReason: string | null;
}

export interface CertTemplateDto {
  type: CertType;
  hasBackground: boolean;
  backgroundName: string | null;
  fields: {
    field: string;
    x: number;
    y: number;
    font: string;
    size: number;
    color: string;
    align: string;
    maxWidth: number;
  }[];
  awardTexts: Record<string, string>;
  version: number;
}
export interface CertificateDto {
  id: string;
  code: string;
  type: CertType;
  awardText: string | null;
  name: string;
  teamName: string | null;
  version: number;
  status: 'GENERATED' | 'RELEASED' | 'REVOKED' | 'FLAGGED' | 'NEEDS_REGENERATION';
  releasedAt: string | null;
  revokedReason: string | null;
  flaggedReason: string | null;
  membershipId: string;
}
export interface MyCertificate extends CertificateDto {
  downloadable: boolean;
  withdrawn: boolean;
  eventId?: string;
  eventName?: string;
}
export interface CorrectionDto {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  requestedName: string;
  currentName: string;
  code: string;
  type: CertType;
  decisionNote: string | null;
  createdAt: string;
}
export interface JobDto {
  id: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  total: number;
  done: number;
  failed: number;
  error: string | null;
}

const ev = (id: string) => `/events/${id}`;

export const engageApi = {
  forms: (id: string) => request<{ forms: FeedbackFormDto[] }>('GET', `${ev(id)}/feedback/forms`),
  saveForm: (
    id: string,
    a: Audience,
    body: { questions: FeedbackQuestion[]; confidential: boolean; closeAt: string | null },
  ) => request<FeedbackFormDto>('PUT', `${ev(id)}/feedback/forms/${a}`, body),
  formState: (id: string, a: Audience, state: string) =>
    request<{ state: string }>('POST', `${ev(id)}/feedback/forms/${a}/state`, { state }),
  results: (id: string, a: Audience) =>
    request<FeedbackAggregate>('GET', `${ev(id)}/feedback/results/${a}`),
  mine: (id: string) => request<MyFeedback>('GET', `${ev(id)}/feedback/mine`),
  submit: (id: string, answers: Record<string, string | number>) =>
    request<{ ok: true }>('POST', `${ev(id)}/feedback/responses`, { answers }),
  comments: (id: string, roundId: string) =>
    request<{
      released: boolean;
      releasedAt: string | null;
      resultsPublished: boolean;
      comments: CommentRow[];
    }>('GET', `${ev(id)}/rounds/${roundId}/comments`),
  releaseComments: (id: string, roundId: string) =>
    request<unknown>('POST', `${ev(id)}/rounds/${roundId}/comments/release`),
  withdrawComments: (id: string, roundId: string) =>
    request<unknown>('POST', `${ev(id)}/rounds/${roundId}/comments/withdraw`),
  commentVisibility: (id: string, evaluationId: string, hidden: boolean, reason?: string) =>
    request<unknown>('PUT', `${ev(id)}/evaluations/${evaluationId}/comment-visibility`, {
      hidden,
      reason,
    }),
  teamComments: (id: string) =>
    request<{
      rounds: {
        roundId: string;
        roundName: string;
        comments: { label: string; comment: string }[];
      }[];
    }>('GET', `${ev(id)}/feedback/team-comments`),

  templates: (id: string) =>
    request<{ templates: CertTemplateDto[] }>('GET', `${ev(id)}/certificates/templates`),
  saveTemplate: (
    id: string,
    type: CertType,
    body: Pick<CertTemplateDto, 'fields' | 'awardTexts'>,
  ) => request<unknown>('PUT', `${ev(id)}/certificates/templates/${type}`, body),
  eligibility: (id: string, type: CertType) =>
    request<{ eligible: number; existing: number; names: string[] }>(
      'GET',
      `${ev(id)}/certificates/eligibility/${type}`,
    ),
  generate: (id: string, type: CertType) =>
    request<{ jobId: string }>('POST', `${ev(id)}/certificates/generate`, { type }),
  job: (id: string, jobId: string) =>
    request<JobDto>('GET', `${ev(id)}/certificates/jobs/${jobId}`),
  certificates: (id: string, qs: string) =>
    request<{
      certificates: CertificateDto[];
      counts: { type: CertType; status: string; n: number }[];
    }>('GET', `${ev(id)}/certificates?${qs}`),
  release: (id: string, type: CertType) =>
    request<{ released: number }>('POST', `${ev(id)}/certificates/release`, {
      type,
      reviewed: true,
    }),
  revoke: (id: string, certId: string, reason: string) =>
    request<unknown>('POST', `${ev(id)}/certificates/${certId}/revoke`, { reason }),
  unrevoke: (id: string, certId: string) =>
    request<unknown>('POST', `${ev(id)}/certificates/${certId}/unrevoke`),
  acknowledge: (id: string, certId: string) =>
    request<unknown>('POST', `${ev(id)}/certificates/${certId}/acknowledge`),
  regenerate: (id: string, certId: string) =>
    request<unknown>('POST', `${ev(id)}/certificates/${certId}/regenerate`),
  corrections: (id: string) =>
    request<{ corrections: CorrectionDto[] }>('GET', `${ev(id)}/certificates/corrections`),
  decide: (id: string, correctionId: string, approve: boolean, note?: string) =>
    request<unknown>('POST', `${ev(id)}/certificates/corrections/${correctionId}/decide`, {
      approve,
      note,
    }),
  myCertificates: (id: string) =>
    request<{ certificates: MyCertificate[] }>('GET', `${ev(id)}/certificates/mine`),
  requestCorrection: (id: string, certId: string, name: string) =>
    request<unknown>('POST', `${ev(id)}/certificates/${certId}/correction-request`, { name }),
};

export interface IntegrationsDto {
  configured: boolean;
  connection: {
    status: 'CONNECTED' | 'NEEDS_REAUTH';
    googleEmail: string;
    spreadsheetUrl: string | null;
    driveEnabled: boolean;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastResult: string | null;
    lastError: string | null;
    lastErrorDetail: string | null;
  } | null;
  jobs: {
    id: string;
    kind: 'SHEETS' | 'DRIVE_MIRROR';
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    attempt: number;
    runAfter: string;
    finishedAt: string | null;
    summary: string | null;
    error: string | null;
    errorDetail: string | null;
    createdAt: string;
  }[];
  mirror: Record<string, number>;
}

export const integrationsApi = {
  get: (id: string) => request<IntegrationsDto>('GET', `${ev(id)}/integrations`),
  connect: (id: string, enableDrive: boolean) =>
    request<{ url: string }>('POST', `${ev(id)}/integrations/connect`, {
      acknowledged: true,
      enableDrive,
    }),
  syncNow: (id: string) => request<unknown>('POST', `${ev(id)}/integrations/sync-now`),
  drive: (id: string, enabled: boolean) =>
    request<unknown>('PUT', `${ev(id)}/integrations/drive`, { enabled }),
  newSheet: (id: string) => request<unknown>('POST', `${ev(id)}/integrations/new-spreadsheet`),
  disconnect: (id: string) => request<unknown>('POST', `${ev(id)}/integrations/disconnect`),
};

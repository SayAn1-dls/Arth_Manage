import type { SubmissionStatus, TeamDto, FormFieldDto } from '@arthakram/shared';
import { request } from './api.js';

export interface PublicForm {
  registration: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  declarations: string[];
  soloTeams: boolean;
  customFields: {
    id: string;
    label: string;
    type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'SELECT' | 'URL' | 'CHECKBOX';
    helpText: string | null;
    options: string[];
    required: boolean;
  }[];
}

export interface MyRegistration {
  registration: {
    fullName: string;
    phone: string | null;
    institution: string;
    course: string | null;
    yearOfStudy: string | null;
    certificateName: string;
    answers: Record<string, string | number | boolean>;
    version: number;
    status: 'ACTIVE' | 'WITHDRAWN';
  };
  fields: PublicForm['customFields'];
  editable: 'all' | 'phone_and_certificate_name' | 'none';
}

export interface SubmissionView {
  round: {
    id: string;
    name: string;
    opensAt: string | null;
    submissionDeadline: string | null;
    graceMinutes: number;
    latePolicy: 'REJECT' | 'ACCEPT_AND_FLAG';
  };
  fields: FormFieldDto[];
  status: SubmissionStatus;
  statusLabel: string;
  cutoff: string | null;
  editable: boolean;
  closedReason: string | null;
  extensionDeadline?: string | null;
  minSizeOverride?: boolean;
  team: {
    id: string;
    teamCode: string;
    name: string;
    size: number;
    min: number;
    complete: boolean;
  };
  draft: {
    title: string;
    summary: string;
    values: Record<string, string>;
    version: number;
    hasUnsubmittedChanges: boolean;
  };
  files: { id: string; fieldId: string; name: string; size: number; uploadedAt: string }[];
  versions: {
    versionNo: number;
    title: string;
    summary: string;
    values: Record<string, string>;
    submittedAt: string;
    submittedBy: string;
    lateMinutes: number;
  }[];
}

export const participantApi = {
  publicForm: (slug: string) =>
    request<PublicForm>('GET', `/public/events/${slug}/registration-form`),
  publicMe: (slug: string) =>
    request<{ eventId: string; role: string | null; removed: boolean; registered: boolean }>(
      'GET',
      `/public/events/${slug}/me`,
    ),
  register: (slug: string, body: unknown) =>
    request<{ eventId: string; alreadyRegistered: boolean }>(
      'POST',
      `/public/events/${slug}/register`,
      body,
    ),
  myRegistration: (eventId: string) =>
    request<MyRegistration>('GET', `/events/${eventId}/registration/me`),
  updateRegistration: (eventId: string, body: unknown) =>
    request<{ version: number }>('PATCH', `/events/${eventId}/registration/me`, body),
  myTeam: (eventId: string) =>
    request<{ team: TeamDto | null }>('GET', `/events/${eventId}/my-team`).then((r) => r.team),
  createTeam: (eventId: string, name: string) =>
    request<{ team: TeamDto }>('POST', `/events/${eventId}/teams`, { name }),
  previewJoin: (eventId: string, code: string) =>
    request<{ name: string; leaderName: string; size: number; max: number; full: boolean }>(
      'POST',
      `/events/${eventId}/teams/join/preview`,
      { code },
    ),
  join: (eventId: string, code: string) =>
    request<{ team: TeamDto }>('POST', `/events/${eventId}/teams/join`, { code }),
  updateTeam: (eventId: string, body: unknown) =>
    request<{ team: TeamDto }>('PATCH', `/events/${eventId}/my-team`, body),
  regenerateCode: (eventId: string) =>
    request<{ team: TeamDto }>('POST', `/events/${eventId}/my-team/regenerate-code`),
  removeMember: (eventId: string, membershipId: string) =>
    request<{ team: TeamDto }>('DELETE', `/events/${eventId}/my-team/members/${membershipId}`),
  leave: (eventId: string) =>
    request<{ left: boolean; dissolved: boolean }>('POST', `/events/${eventId}/my-team/leave`),
  transfer: (eventId: string, membershipId: string) =>
    request<{ team: TeamDto }>('POST', `/events/${eventId}/my-team/transfer`, { membershipId }),
  submission: (eventId: string, roundId: string) =>
    request<SubmissionView>('GET', `/events/${eventId}/rounds/${roundId}/submission`),
  saveDraft: (eventId: string, roundId: string, body: unknown) =>
    request<{ version: number; savedAt: string }>(
      'PUT',
      `/events/${eventId}/rounds/${roundId}/submission/draft`,
      body,
    ),
  submit: (eventId: string, roundId: string, version: number) =>
    request<{ versionNo: number; submittedAt: string; lateMinutes: number }>(
      'POST',
      `/events/${eventId}/rounds/${roundId}/submission/submit`,
      { version },
    ),
  discardDraft: (eventId: string, roundId: string) =>
    request<SubmissionView>(
      'POST',
      `/events/${eventId}/rounds/${roundId}/submission/discard-draft`,
    ),
};

/** Upload with progress. fetch has no upload progress events, so this uses XMLHttpRequest. */
export function uploadSubmissionFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ file: { id: string; fieldId: string; name: string; size: number }; version: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'arthakram');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('Upload failed. Your other answers are saved. Retry.'));
    xhr.onload = () => {
      let body: { error?: { message?: string } } & Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as never);
      else
        reject(
          new Error(body.error?.message ?? 'Upload failed. Your other answers are saved. Retry.'),
        );
    };
    xhr.send(file);
  });
}

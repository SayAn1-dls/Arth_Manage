import { useQuery } from '@tanstack/react-query';
import type { EventDto, GuidebookSection, RoundDto } from '@arthakram/shared';
import { request } from './api.js';

export interface Track {
  id: string;
  name: string;
  description: string | null;
  order: number;
}
export interface Problem {
  id: string;
  title: string;
  description: string;
  trackId: string | null;
  order: number;
}
export type Round = RoundDto & { id: string };
export interface Announcement {
  id: string;
  audience: 'EVERYONE' | 'PARTICIPANTS' | 'JUDGES' | 'STAFF';
  title: string;
  body: string;
  createdAt: string;
  edited: boolean;
}
export interface PublishedGuidebook {
  published: boolean;
  sections: GuidebookSection[];
  versionNo: number | null;
  publishedAt: string | null;
}

export const eventApi = {
  get: (id: string) => request<EventDto>('GET', `/events/${id}`),
  create: (body: unknown) => request<EventDto>('POST', '/events', body),
  update: (id: string, body: unknown) => request<EventDto>('PATCH', `/events/${id}`, body),
  checks: (id: string) =>
    request<{ blocking: string[]; warnings: string[] }>('GET', `/events/${id}/publish-checks`),
  publish: (id: string) =>
    request<{ event: EventDto; warnings: string[] }>('POST', `/events/${id}/publish`),
  unpublish: (id: string) => request<EventDto>('POST', `/events/${id}/unpublish`),
  setRegistration: (id: string, body: unknown) =>
    request<EventDto>('PUT', `/events/${id}/registration`, body),
  conclude: (id: string, confirmWithoutResults: boolean) =>
    request<EventDto>('POST', `/events/${id}/conclude`, { confirmWithoutResults }),
  archive: (id: string) => request<EventDto>('POST', `/events/${id}/archive`),
  tracks: (id: string) =>
    request<{ tracks: Track[] }>('GET', `/events/${id}/tracks`).then((r) => r.tracks),
  problems: (id: string) =>
    request<{ problems: Problem[] }>('GET', `/events/${id}/problems`).then((r) => r.problems),
  rounds: (id: string) =>
    request<{ rounds: Round[] }>('GET', `/events/${id}/rounds`).then((r) => r.rounds),
  announcements: (id: string) =>
    request<{ announcements: Announcement[] }>('GET', `/events/${id}/announcements`).then(
      (r) => r.announcements,
    ),
  guidebook: (id: string) => request<PublishedGuidebook>('GET', `/events/${id}/guidebook`),
};

export function useEvent(eventId: string) {
  return useQuery({ queryKey: ['event', eventId], queryFn: () => eventApi.get(eventId) });
}

export const TIME_ZONES = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export const TYPE_LABEL = {
  HACKATHON: 'Hackathon',
  CASE_COMPETITION: 'Case competition',
  OTHER: 'Other',
} as const;
export const MODE_LABEL = { IN_PERSON: 'In person', ONLINE: 'Online', HYBRID: 'Hybrid' } as const;

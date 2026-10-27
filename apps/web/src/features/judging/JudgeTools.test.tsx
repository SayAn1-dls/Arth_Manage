import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type * as RouterModule from 'react-router';
import { EvaluationPage } from './EvaluationPage.js';
import { judgingApi, type Workspace } from '../../lib/judging.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
import * as api from '../../lib/api.js';
import { JudgeNotebook, VideoHealth, GlossaryText } from './JudgeTools.js';
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (original) => ({
  ...(await original<typeof RouterModule>()),
  useNavigate: () => navigate,
  useParams: () => ({ roundId: 'round', teamId: 'team' }),
  useOutletContext: () => ({
    eventId: 'event',
    name: 'Event',
    role: 'JUDGE',
    timeZone: 'Asia/Kolkata',
  }),
}));
function wrap(child: React.ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        {child}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('judge reading tools', () => {
  it('saves scratchpad separately from scoring and persists the revisit star', async () => {
    const calls: { path: string; body: unknown }[] = [];
    vi.spyOn(api, 'request').mockImplementation(
      async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
        if (method === 'GET')
          return { scratchpad: 'Existing private thought', starred: false, version: 1 } as T;
        calls.push({ path, body });
        return { ...(body as object), version: 2 } as T;
      },
    );
    wrap(<JudgeNotebook eventId="event" assignmentId="assignment" />);
    const area = await screen.findByLabelText('Private scratchpad');
    await waitFor(() => expect(area).toHaveValue('Existing private thought'));
    await userEvent.clear(area);
    await userEvent.type(area, 'Check the demo later');
    await userEvent.click(screen.getByRole('button', { name: 'Save scratchpad' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]!.path).toBe('/events/event/assignments/assignment/memo');
    expect(calls[0]!.body).toMatchObject({ scratchpad: 'Check the demo later' });
    expect(calls.every((c) => !c.path.includes('/evaluation'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /revisit later/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /starred for revisit/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });
  it('shows a stale-note error without pretending the note saved', async () => {
    vi.spyOn(api, 'request').mockImplementation(async <T,>(method: string): Promise<T> => {
      if (method === 'GET') return { scratchpad: 'Original', starred: false, version: 1 } as T;
      throw new api.ApiError(409, 'stale_memo', 'Your scratchpad changed in another tab.');
    });
    wrap(<JudgeNotebook eventId="event" assignmentId="assignment" />);
    const area = await screen.findByLabelText('Private scratchpad');
    await waitFor(() => expect(area).toHaveValue('Original'));
    await userEvent.type(area, ' New text');
    await userEvent.click(screen.getByRole('button', { name: 'Save scratchpad' }));
    expect(await screen.findByText('Your scratchpad changed in another tab.')).toBeVisible();
    expect(area).toHaveValue('Original New text');
  });
  it('does not claim a provider video is playable without evidence', () => {
    wrap(<VideoHealth url="https://www.youtube.com/watch?v=example" />);
    expect(screen.getByText(/Video playback unverified/)).toBeVisible();
  });
  it('distinguishes metadata from actual playable media', () => {
    const { container } = wrap(<VideoHealth url="https://example.com/demo.mp4" />);
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: 125, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText('Video metadata loaded · 2:05')).toBeVisible();
    expect(screen.queryByText('Video playable · 2:05')).toBeNull();
    fireEvent.canPlay(video);
    expect(screen.getByText('Video playable · 2:05')).toBeVisible();
  });
  it('limits track-specific hover definitions to the team’s track', async () => {
    vi.spyOn(api, 'request').mockResolvedValue({
      briefing: {},
      tracks: [
        { id: 'health', name: 'Health' },
        { id: 'finance', name: 'Finance' },
      ],
      glossary: [
        { id: 'fhir', term: 'FHIR', definition: 'Healthcare data standard', trackId: 'health' },
        { id: 'upi', term: 'UPI', definition: 'Payment interface', trackId: 'finance' },
      ],
    });
    wrap(<GlossaryText eventId="event" track="Health" text="FHIR and UPI integration" />);
    await waitFor(() => expect(screen.getByTitle('Healthcare data standard')).toBeVisible());
    expect(screen.queryByTitle('Payment interface')).toBeNull();
    expect(screen.getByTitle('Healthcare data standard')).toHaveAttribute('tabindex', '0');
  });
  it('scores with number keys, ignores next-team shortcuts inside text fields, and saves before navigation', async () => {
    navigate.mockClear();
    const workspace: Workspace = {
      assignmentId: 'assignment',
      assignmentStatus: 'ACTIVE',
      conflictReason: null,
      team: { id: 'team', teamCode: 'T-1', name: 'Test team' },
      round: { id: 'round', name: 'Round', judgingStatus: 'OPEN' },
      prevTeamId: null,
      nextTeamId: 'next',
      locked: null,
      editable: true,
      submission: {
        versionNo: 1,
        submittedAt: new Date().toISOString(),
        lateMinutes: 0,
        title: 'Project',
        summary: 'Project summary',
        fields: [],
      },
      rubric: {
        teamCommentMode: 'OPTIONAL',
        criteria: [
          {
            id: 'execution',
            name: 'Execution',
            description: 'Assess implementation',
            weight: 100,
            min: 0,
            max: 10,
          },
        ],
      },
      evaluation: null,
    };
    vi.spyOn(judgingApi, 'workspace').mockResolvedValue(workspace);
    const save = vi
      .spyOn(judgingApi, 'saveEvaluation')
      .mockResolvedValue({ version: 1, status: 'DRAFT' });
    const memoCalls: unknown[] = [];
    vi.spyOn(api, 'request').mockImplementation(
      async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
        if (path.endsWith('/memo')) {
          if (method === 'PUT') memoCalls.push(body);
          return { scratchpad: '', starred: false, version: method === 'GET' ? 0 : 1 } as T;
        }
        return { briefing: {}, tracks: [], glossary: [] } as T;
      },
    );
    wrap(<EvaluationPage />);
    const score = await screen.findByLabelText('Execution (100%)');
    fireEvent.keyDown(document.body, { key: '7' });
    await waitFor(() => expect(score).toHaveValue(7));
    const note = screen.getByLabelText('Private scratchpad');
    await waitFor(() => expect(note).toBeEnabled());
    await userEvent.type(note, 'Remember the limitations');
    fireEvent.keyDown(note, { key: 'n' });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'n' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/events/event/judge/round/next'));
    expect(save).toHaveBeenCalled();
    expect(memoCalls[0]).toMatchObject({ scratchpad: 'Remember the limitations' });
  });
});

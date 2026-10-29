import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { activeGroupId, navFor } from '../shell/nav.js';
import type { Role } from '@arthakram/shared';
import { CollapsibleNav } from './CollapsibleNav.js';
import { navStorageKey, parseNavChoices } from './navState.js';

function Menu({ role }: { role: Role }) {
  const { eventId = '' } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const groups = navFor(role);
  const section = pathname.split('/')[3] ?? '';
  return (
    <>
      <button onClick={() => navigate(-1)}>history-back</button>
      <button onClick={() => navigate(1)}>history-forward</button>
      <CollapsibleNav
        label="Event"
        groups={groups}
        activeGroupId={activeGroupId(groups, section)}
        pageKey={pathname}
        currentLabel={
          groups.flatMap((g) => g.items).find((i) => i.to.split('/')[0] === section)?.label
        }
        scope={`${role}:${eventId}`}
      />
    </>
  );
}

function renderAt(path: string, role: Role = 'ADMIN') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:eventId" element={<Menu role={role} />}>
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const heading = (name: string) => screen.getByRole('button', { name });

beforeEach(() => window.localStorage.clear());

describe('CollapsibleNav', () => {
  it('opens only the group holding the current page and marks the page', () => {
    renderAt('/events/e1/checkin');
    expect(heading('Event day')).toHaveAttribute('aria-expanded', 'true');
    for (const other of [
      'Run the event',
      'Judging and results',
      'Set up',
      'After the event',
      'Records',
    ])
      expect(heading(other)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Check-in' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Rubric' })).not.toBeInTheDocument();
  });

  it('expands the group of a deep link with nested segments', () => {
    renderAt('/events/e1/judge/round-1/team-9', 'JUDGE');
    expect(heading('Judging')).toHaveAttribute('aria-expanded', 'true');
    expect(heading('Resources')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'My teams' })).toHaveAttribute('aria-current', 'page');
  });

  it('expands and collapses with the mouse and with the keyboard', async () => {
    const user = userEvent.setup();
    renderAt('/events/e1');
    await user.click(heading('Set up'));
    expect(screen.getByRole('link', { name: 'Guidebook' })).toBeVisible();
    await user.click(heading('Set up'));
    expect(screen.queryByRole('link', { name: 'Guidebook' })).not.toBeInTheDocument();

    heading('Records').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: 'Audit history' })).toBeVisible();
    await user.keyboard(' ');
    expect(screen.queryByRole('link', { name: 'Audit history' })).not.toBeInTheDocument();
  });

  it('keeps collapsed links out of the tab order', async () => {
    const user = userEvent.setup();
    renderAt('/events/e1');
    const nav = screen.getByRole('navigation', { name: 'Event' });
    // Collapsed groups contribute only their heading button to the tab sequence.
    const stops = [];
    for (let i = 0; i < 20; i++) {
      await user.tab();
      if (nav.contains(document.activeElement)) stops.push(document.activeElement);
    }
    expect(stops.some((el) => el?.textContent === 'Rubric')).toBe(false);
  });

  it('moving to another page in a collapsed-by-user group reveals it again', async () => {
    const user = userEvent.setup();
    renderAt('/events/e1');
    await user.click(heading('Run the event'));
    expect(heading('Run the event')).toHaveAttribute('aria-expanded', 'false');
    await user.click(heading('Set up'));
    await user.click(screen.getByRole('link', { name: 'Guidebook' }));
    expect(screen.getByRole('link', { name: 'Guidebook' })).toHaveAttribute('aria-current', 'page');
    await user.click(heading('Set up')); // user collapses the active group
    expect(screen.queryByRole('link', { name: 'Guidebook' })).not.toBeInTheDocument();
    await user.click(heading('Set up'));
    await user.click(screen.getByRole('link', { name: 'Setup' }));
    expect(heading('Set up')).toHaveAttribute('aria-expanded', 'true');
  });

  it('follows browser back and forward across groups', async () => {
    const user = userEvent.setup();
    renderAt('/events/e1/teams');
    await user.click(heading('Judging and results'));
    await user.click(screen.getByRole('link', { name: 'Rubric' }));
    expect(screen.getByRole('link', { name: 'Rubric' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByText('history-back'));
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByText('history-forward'));
    expect(screen.getByRole('link', { name: 'Rubric' })).toHaveAttribute('aria-current', 'page');
  });

  it('remembers manual choices across a reload, scoped to role and event', async () => {
    const user = userEvent.setup();
    const first = renderAt('/events/e1');
    await user.click(heading('Records'));
    expect(JSON.parse(window.localStorage.getItem(navStorageKey('ADMIN:e1'))!)).toEqual({
      records: true,
    });
    first.unmount();

    renderAt('/events/e1'); // "refresh"
    expect(heading('Records')).toHaveAttribute('aria-expanded', 'true');
    expect(heading('Run the event')).toHaveAttribute('aria-expanded', 'true'); // current page
    expect(heading('Set up')).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not leak preferences to another event or role', async () => {
    const user = userEvent.setup();
    const first = renderAt('/events/e1');
    await user.click(heading('Records'));
    first.unmount();
    renderAt('/events/e2');
    expect(heading('Records')).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores malformed or outdated stored state', () => {
    window.localStorage.setItem(navStorageKey('ADMIN:e1'), '{not json');
    renderAt('/events/e1');
    expect(heading('Run the event')).toHaveAttribute('aria-expanded', 'true');
    expect(heading('Records')).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders role-specific groups for participants, judges and staff', () => {
    const labels = (role: Role) => {
      const { unmount } = renderAt('/events/e1', role);
      const names = within(screen.getByRole('navigation', { name: 'Event' }))
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) => !t?.startsWith('Menu'));
      unmount();
      return names;
    };
    expect(labels('PARTICIPANT')).toEqual([
      'My workspace',
      'Participation',
      'Information',
      'Communication',
    ]);
    expect(labels('JUDGE')).toEqual(['Judging', 'Resources', 'Communication']);
    expect(labels('STAFF')).toEqual(['My tasks', 'Event operations', 'Help and information']);
  });
});

describe('small-screen menu', () => {
  const toggle = () => screen.getByRole('button', { name: /^Menu/ });
  const panel = () => document.getElementById(toggle().getAttribute('aria-controls')!)!;

  it('starts folded, names the current page, and opens and closes on demand', async () => {
    const user = userEvent.setup();
    renderAt('/events/e1/checkin');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveTextContent('Menu · Check-in');
    expect(panel()).toHaveClass('hidden'); // hidden below lg, shown by `lg:flex` on wide screens
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).not.toHaveClass('hidden');
    await user.click(toggle());
    expect(panel()).toHaveClass('hidden');
  });

  it('folds again after a destination is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/events/e1/checkin');
    await user.click(toggle());
    await user.click(screen.getByRole('link', { name: 'Staff tasks' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('parseNavChoices', () => {
  const ids = ['a', 'b'];
  it('keeps only known ids with boolean values', () => {
    expect(parseNavChoices('{"a":true,"b":"yes","c":true}', ids)).toEqual({ a: true });
  });
  it.each([null, '', 'null', '[]', '"x"', '42', '{oops'])('returns {} for %s', (raw) => {
    expect(parseNavChoices(raw, ids)).toEqual({});
  });
});

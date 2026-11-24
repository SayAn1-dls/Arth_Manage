import { Link, useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { useEvent } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { Alert, Spinner } from '../../ui/index.js';
import { ParticipantPanel } from '../participant/DashboardPanel.js';
import { DashboardCards } from '../ops/DashboardCards.js';
import { StaffPanel } from '../staff/StaffPages.js';
import { JudgeRoundsPanel } from '../judging/JudgePages.js';

const EVENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft, not public yet',
  PUBLISHED: 'Published',
  CONCLUDED: 'Concluded',
  ARCHIVED: 'Archived',
};
const REGISTRATION_LABEL: Record<string, string> = {
  NOT_OPEN: 'not open yet',
  OPEN: 'open',
  CLOSED: 'closed',
};

/**
 * The event index: every role lands on its own dashboard, built from persisted data and centred on that
 * person's next required action (PRD §11.6). Core Admin: lifecycle dashboard. Participant: My event.
 * Judge: assigned rounds and progress. Staff: check-in, tasks and issues.
 */
export function EventOverviewPage() {
  const mine = useOutletContext<MyEvent>();
  const event = useEvent(mine.eventId);
  if (event.isPending) return <Spinner label="Loading dashboard" />;
  const e = event.data;
  if (!e) return <Alert tone="error" title="We couldn't load this event" />;
  const base = `/events/${mine.eventId}`;
  const when = `${formatDateTime(e.startsAt, e.timeZone)} to ${formatDateTime(e.endsAt, e.timeZone)}${e.venue ? ` · ${e.venue}` : ''}`;

  switch (mine.role) {
    case 'ADMIN':
      return (
        <DashboardCards
          mine={mine}
          identity={
            <p className="text-ink">
              <strong>{EVENT_STATUS_LABEL[e.status] ?? e.status}</strong>
              {e.status === 'PUBLISHED' && (
                <> · Registration {REGISTRATION_LABEL[e.registrationStatus] ?? ''}</>
              )}{' '}
              · {when}
            </p>
          }
        />
      );
    case 'PARTICIPANT':
      return <ParticipantPanel mine={mine} />;
    case 'STAFF':
      return <StaffPanel mine={mine} />;
    case 'JUDGE':
      return (
        <div className="flex flex-col gap-6">
          <div>
            <h2>Judge dashboard</h2>
            <p className="mt-1">{when}</p>
          </div>
          <JudgeRoundsPanel mine={mine} />
          <section aria-labelledby="judge-help-h" className="flex flex-col gap-2">
            <h3 id="judge-help-h">Before and while you judge</h3>
            <ul className="flex flex-col gap-1">
              <li>
                <Link to={`${base}/briefing`}>Read the judge briefing</Link>: how the rubric works,
                scored examples and who to contact.
              </li>
              <li>
                <Link to={`${base}/practice`}>Try the practice team</Link>: a made-up submission,
                nothing is saved.
              </li>
              <li>
                <Link to={`${base}/updates`}>Updates</Link> from the organisers, or{' '}
                <Link to={`${base}/support`}>ask them a question</Link>.
              </li>
            </ul>
          </section>
        </div>
      );
  }
}

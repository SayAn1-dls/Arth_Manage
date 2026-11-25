import { useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { useEvent } from '../../lib/events.js';
import { Alert, Spinner } from '../../ui/index.js';
import { ParticipantPanel } from '../participant/DashboardPanel.js';
import { CommandCentre } from '../ops/CommandCentre.js';
import { StaffPanel } from '../staff/StaffPages.js';
import { JudgeHome } from '../judging/JudgePages.js';

/**
 * The event index: every role lands on its own dashboard, built from persisted data and centred on that
 * person's next required action (PRD §11.6). Core Admin: the Command Centre. Participant: My event.
 * Judge: assigned rounds and progress. Staff: check-in, tasks and issues.
 */
export function EventOverviewPage() {
  const mine = useOutletContext<MyEvent>();
  const event = useEvent(mine.eventId);
  if (event.isPending) return <Spinner label="Loading dashboard" />;
  if (!event.data) return <Alert tone="error" title="We couldn't load this event" />;

  switch (mine.role) {
    case 'ADMIN':
      return <CommandCentre mine={mine} />;
    case 'PARTICIPANT':
      return <ParticipantPanel mine={mine} />;
    case 'STAFF':
      return <StaffPanel mine={mine} />;
    case 'JUDGE':
      return <JudgeHome mine={mine} />;
  }
}

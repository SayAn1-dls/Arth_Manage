import { useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js';
import { Card } from '../../ui/index.js';

export function EventOverviewPage() {
  const mine = useOutletContext<MyEvent>();
  return (
    <Card footerLabel={`You are signed in as ${ROLE_LABEL[mine.role]}`}>
      <h2>Overview</h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">Starts</dt>
          <dd>{formatDateTime(mine.startsAt, mine.timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">Ends</dt>
          <dd>{formatDateTime(mine.endsAt, mine.timeZone)}</dd>
        </div>
      </dl>
    </Card>
  );
}

import { useState } from 'react';
import { Inbox, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  Eyebrow,
  FormErrorSummary,
  Input,
  Logo,
  Marker,
  Select,
  Skeleton,
  Spinner,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '../ui/index.js';

const swatches = [
  { name: 'Ember', token: '--ak-ember', note: 'Fills, rules, badges. Ink text on top.' },
  { name: 'Paper', token: '--ak-paper', note: 'Page background.' },
  { name: 'Graphite', token: '--ak-graphite', note: 'Body text, counter-arcs.' },
  { name: 'Ink', token: '--ak-ink', note: 'Headlines; text on Ember.' },
  { name: 'Blush', token: '--ak-blush', note: 'Calm supporting panels.' },
  { name: 'Peach', token: '--ak-peach', note: 'Marker highlights.' },
  { name: 'Sunrise', token: '--ak-sunrise', note: 'Gradient end only.' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <Eyebrow>{title}</Eyebrow>
      <div className="mt-3 flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** Dev-only component gallery used for visual QA against the brand kit (docs/BRAND_IMPLEMENTATION.md §9). */
export function DesignGalleryPage() {
  const [open, setOpen] = useState(false);

  return (
    <main className="mx-auto max-w-content px-4 py-10 sm:px-8">
      <Logo width={150} />
      <h1 className="mt-6">
        Design <Marker>system</Marker>
      </h1>
      <p className="mt-3">Every component used by the product, on Paper, as the kit intends.</p>

      <Section title="Colour">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map((s) => (
            <div key={s.token} className="overflow-hidden rounded-card bg-white shadow-card">
              <div
                className="h-16 border-b border-line"
                style={{ background: `var(${s.token})` }}
              />
              <div className="p-3">
                <p className="font-bold text-ink">{s.name}</p>
                <p className="text-xs">{s.note}</p>
              </div>
            </div>
          ))}
          <div className="overflow-hidden rounded-card bg-white shadow-card">
            <div className="h-16 bg-brand-gradient" />
            <div className="p-3">
              <p className="font-bold text-ink">Gradient</p>
              <p className="text-xs">Top to bottom only.</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Typography">
        <h1>Display heading in Bricolage</h1>
        <h2>Section heading in Bricolage</h2>
        <h3>Subsection heading</h3>
        <p>
          Body copy is Instrument Sans in Graphite on Paper, held to a comfortable measure of about
          sixty-five characters. <strong>Bold is the only inline emphasis.</strong>{' '}
          <a href="#top">Links are underlined.</a>
        </p>
        <p className="font-hand text-2xl text-ink">a small handwritten aside</p>
      </Section>

      <Section title="Logo on the four approved surfaces">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="grid place-items-center rounded-card bg-paper p-6 ring-1 ring-line">
            <Logo surface="paper" width={140} />
          </div>
          <div className="grid place-items-center rounded-card bg-white p-6">
            <Logo surface="white" width={140} />
          </div>
          <div className="grid place-items-center rounded-card bg-ember p-6">
            <Logo surface="ember" width={140} />
          </div>
          <div className="grid place-items-center rounded-card bg-ink p-6">
            <Logo surface="ink" width={140} />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Logo mark width={40} />
          <Logo surface="ember" mark width={40} />
          <span className="text-sm">Feather mark below 120px</span>
        </div>
      </Section>

      <Section title="Buttons and badges">
        <div className="flex flex-wrap gap-3">
          <Button icon={<Plus aria-hidden className="size-4" />}>Create event</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Skip for now</Button>
          <Button variant="danger" icon={<Trash2 aria-hidden className="size-4" />}>
            Remove team
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Unavailable</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Hackathon 2026</Badge>
          <Badge tone="success">Submitted</Badge>
          <Badge tone="warning">Deadline soon</Badge>
          <Badge tone="error">Missing evaluation</Badge>
          <Badge tone="info">Draft</Badge>
        </div>
      </Section>

      <Section title="Forms">
        <FormErrorSummary
          issues={[
            { fieldId: 'gallery-name', message: 'Team name is required' },
            { message: 'Fix the highlighted fields and try again' },
          ]}
        />
        <Card footerLabel="Team details" className="max-w-form">
          <div className="flex flex-col gap-4">
            <Input
              id="gallery-name"
              label="Team name"
              hint="Visible to organisers and judges."
              required
            />
            <Input
              label="Contact email"
              type="email"
              defaultValue="not-an-email"
              error="Enter a valid email address."
            />
            <Select label="Track" defaultValue="">
              <option value="" disabled>
                Select a track
              </option>
              <option>Fintech</option>
              <option>Climate</option>
            </Select>
            <Textarea label="Project summary" hint="Up to 5,000 characters." />
            <Checkbox label="I accept the participation rules" hint="Required to register." />
          </div>
        </Card>
      </Section>

      <Section title="Alerts">
        <Alert tone="info" title="Registration opens on 1 Feb, 10:00 IST" />
        <Alert tone="success" title="Submission received">
          A receipt was sent to all team members.
        </Alert>
        <Alert tone="warning" title="Deadline in 2 hours">
          Incomplete drafts are not submitted automatically.
        </Alert>
        <Alert tone="error" title="Upload failed">
          The file type does not match its extension.
        </Alert>
      </Section>

      <Section title="Table">
        <Table caption="Teams">
          <THead>
            <Tr>
              <Th>Team</Th>
              <Th>Track</Th>
              <Th>Members</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            <Tr>
              <Td>T-0001 Byte Me</Td>
              <Td>Fintech</Td>
              <Td>4 / 4</Td>
              <Td>
                <Badge tone="success">Complete</Badge>
              </Td>
            </Tr>
            <Tr>
              <Td>T-0002 Quill Squad</Td>
              <Td>Climate</Td>
              <Td>1 / 2</Td>
              <Td>
                <Badge tone="warning">Incomplete</Badge>
              </Td>
            </Tr>
          </TBody>
        </Table>
      </Section>

      <Section title="Empty, loading, dialog">
        <EmptyState
          title="No teams yet"
          action={
            <Button icon={<Inbox aria-hidden className="size-4" />}>Share registration link</Button>
          }
        >
          Teams appear here as participants register and create them.
        </EmptyState>
        <div className="flex items-center gap-6">
          <Spinner label="Loading teams" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open dialog
          </Button>
          <Dialog
            open={open}
            title="Publish results?"
            onClose={() => setOpen(false)}
            actions={
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setOpen(false)}>Publish results</Button>
              </>
            }
          >
            <p>
              Participants will see the winners list immediately. This cannot be undone without
              republishing.
            </p>
          </Dialog>
        </div>
      </Section>
    </main>
  );
}

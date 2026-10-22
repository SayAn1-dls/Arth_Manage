import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  THead,
  Th,
  Tr,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

interface Members {
  members: {
    membershipId: string;
    name: string;
    email: string;
    role: 'ADMIN' | 'JUDGE' | 'STAFF';
    owner: boolean;
  }[];
  invitations: {
    id: string;
    email: string;
    role: 'ADMIN' | 'JUDGE' | 'STAFF';
    expiresAt: string;
  }[];
}

/** Core admins, judges and helping staff: invite by email, see pending invitations, remove access (PRD FR-006). */
export function PeoplePage() {
  const mine = useOutletContext<MyEvent>();
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'JUDGE' | 'STAFF'>('JUDGE');
  const [sent, setSent] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['members', mine.eventId],
    queryFn: () => request<Members>('GET', `/events/${mine.eventId}/members`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['members', mine.eventId] });
  const invite = useMutation({
    mutationFn: () => request('POST', `/events/${mine.eventId}/invitations`, { email, role }),
    onSuccess: async () => {
      errors.clear();
      setSent(email);
      setEmail('');
      await refresh();
    },
    onError: errors.capture,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => request('DELETE', `/events/${mine.eventId}/invitations/${id}`),
    onSuccess: refresh,
    onError: errors.capture,
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => request('DELETE', `/events/${mine.eventId}/members/${id}`),
    onSuccess: refresh,
    onError: errors.capture,
  });

  return (
    <div className="flex flex-col gap-4">
      <h2>People</h2>
      <p>
        Participants are managed on the Participants page. Here you manage the organising team,
        judges and helping staff. Each person holds one role per event.
      </p>
      <Card footerLabel="Invite someone">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            errors.clear();
            setSent(null);
            invite.mutate();
          }}
        >
          <Input
            id="inv-email"
            type="email"
            label="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.fields.email}
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="JUDGE">Judge</option>
            <option value="STAFF">Helping staff</option>
            <option value="ADMIN">Core admin</option>
          </Select>
          <Button type="submit" loading={invite.isPending}>
            Send invitation
          </Button>
        </form>
        <FormErrorSummary issues={errors.issues({ email: 'inv-email' })} />
        {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
        {sent && (
          <Alert className="mt-3" tone="success" title={`Invitation sent to ${sent}`}>
            They accept it by signing in with that email address. The link works once and expires in
            14 days.
          </Alert>
        )}
      </Card>

      {q.isPending && <Spinner label="Loading people" />}
      {q.data && (
        <>
          <Table caption="Organisers, judges and staff">
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {q.data.members.map((m) => (
                <Tr key={m.membershipId}>
                  <Td>{m.name}</Td>
                  <Td>{m.email}</Td>
                  <Td>
                    <Badge tone={m.role === 'ADMIN' ? 'brand' : 'info'}>{ROLE_LABEL[m.role]}</Badge>{' '}
                    {m.owner && <Badge tone="info">Owner</Badge>}
                  </Td>
                  <Td>
                    {!m.owner && (
                      <Button variant="ghost" onClick={() => removeMember.mutate(m.membershipId)}>
                        Remove
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <section aria-labelledby="pending-h" className="flex flex-col gap-2">
            <h3 id="pending-h">Pending invitations</h3>
            {q.data.invitations.length === 0 && (
              <EmptyState title="No pending invitations">
                Invited people appear here until they accept.
              </EmptyState>
            )}
            <ul className="flex flex-col gap-2">
              {q.data.invitations.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-white p-3 shadow-card"
                >
                  <span>
                    {i.email} · {ROLE_LABEL[i.role]} · expires{' '}
                    {formatDateTime(i.expiresAt, mine.timeZone)}
                  </span>
                  <Button variant="ghost" onClick={() => revoke.mutate(i.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

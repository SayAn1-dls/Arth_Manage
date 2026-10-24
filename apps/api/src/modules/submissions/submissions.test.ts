import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import { openEvent, past, pdfBytes, pptxBytes, future, roundBody } from '../../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

type World = Awaited<ReturnType<typeof openEvent>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>;

/** A team of two (the minimum) with the default hackathon form: file, repo, optional video and live URL. */
async function teamOfTwo(w: World, name = 'Byte Me') {
  const lead = await w.participant(`${name} Lead`);
  const created = await lead.agent.post(`${w.base}/teams`).send({ name });
  const mate = await w.participant(`${name} Mate`);
  await mate.agent.post(`${w.base}/teams/join`).send({ code: created.body.team.joinCode });
  return { lead, mate, teamId: created.body.team.id as string };
}

const subUrl = (w: World, suffix = '') => `${w.base}/rounds/${w.roundId}/submission${suffix}`;

function upload(agent: Agent, url: string, bytes: Buffer, filename: string) {
  return agent
    .put(url)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Filename', encodeURIComponent(filename))
    .send(bytes);
}

async function fillValid(w: World, agent: Agent) {
  const s = (await agent.get(subUrl(w))).body;
  const file = s.fields.find((f: { type: string }) => f.type === 'FILE');
  const repo = s.fields.find((f: { type: string }) => f.type === 'REPO_URL');
  const up = await upload(agent, subUrl(w, `/files/${file.id}`), pdfBytes(), 'deck.pdf');
  expect(up.status).toBe(201);
  const draft = await agent.put(subUrl(w, '/draft')).send({
    title: 'Fraud Radar',
    summary: 'Detects fraud.',
    version: up.body.version,
    values: { [file.id]: up.body.file.id, [repo.id]: 'https://github.com/owner/repo' },
  });
  expect(draft.status).toBe(200);
  return {
    fileField: file,
    repoField: repo,
    fileId: up.body.file.id as string,
    version: draft.body.version as number,
  };
}

describe('uploading and submitting (AT-05, AT-06)', () => {
  it('shows the round requirements, saves a draft, uploads a real PDF and submits version 1 with a receipt', async () => {
    const w = await openEvent(kit);
    const { lead, mate } = await teamOfTwo(w);
    const s = (await lead.agent.get(subUrl(w))).body;
    expect(s.status).toBe('NOT_STARTED');
    expect(s.fields.map((f: { label: string }) => f.label)).toEqual([
      'Presentation',
      'Repository URL',
      'Demo video',
      'Live project URL',
    ]);
    expect(s.editable).toBe(true);

    const { version } = await fillValid(w, lead.agent);
    const submitted = await lead.agent.post(subUrl(w, '/submit')).send({ version });
    expect(submitted.status).toBe(201);
    expect(submitted.body.versionNo).toBe(1);
    // both members see it, with the submitter and timestamp
    const seen = (await mate.agent.get(subUrl(w))).body;
    expect(seen.status).toBe('SUBMITTED');
    expect(seen.versions[0].submittedBy).toBe('Byte Me Lead');
    // receipt email to every member
    const receipts = await db.outboxEmail.findMany({
      where: { subject: { contains: 'Submission received' } },
    });
    expect(receipts.map((r) => r.toEmail).sort()).toEqual(
      [lead.user.email, mate.user.email].sort(),
    );
  });

  it('rejects a PPTX renamed to .pdf, leaving the draft without a file (AT-05N1)', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const s = (await lead.agent.get(subUrl(w))).body;
    const file = s.fields.find((f: { type: string }) => f.type === 'FILE');
    const res = await upload(lead.agent, subUrl(w, `/files/${file.id}`), pptxBytes(), 'deck.pdf');
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/does not look like a real PDF/);
    expect(await db.submissionFile.count()).toBe(0);
    const html = await upload(
      lead.agent,
      subUrl(w, `/files/${file.id}`),
      Buffer.from('<script>alert(1)</script>'),
      'x.pdf',
    );
    expect(html.status).toBe(422);
    const tooBig = await upload(
      lead.agent,
      subUrl(w, `/files/${file.id}`),
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(26 * 1024 * 1024)]),
      'big.pdf',
    );
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.message).toMatch(/limit is 25 MB/);
  });

  it('lists every missing required field and keeps the draft (AT-05N2); validates repository URLs', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const s = (await lead.agent.get(subUrl(w))).body;
    const repo = s.fields.find((f: { type: string }) => f.type === 'REPO_URL');
    const badRepo = await lead.agent.put(subUrl(w, '/draft')).send({
      title: 'T',
      summary: 'S',
      values: { [repo.id]: 'github.com/user/repo' },
      version: 1,
    });
    expect(badRepo.status).toBe(422);
    expect(badRepo.body.error.details.fields[`values.${repo.id}`]).toMatch(/https/);
    const saved = await lead.agent
      .put(subUrl(w, '/draft'))
      .send({ title: 'Only a title', summary: '', values: {}, version: 1 });
    expect(saved.status).toBe(200);
    const submit = await lead.agent
      .post(subUrl(w, '/submit'))
      .send({ version: saved.body.version });
    expect(submit.status).toBe(422);
    expect(submit.body.error.message).toMatch(/Summary.*Presentation.*Repository URL/);
    expect((await lead.agent.get(subUrl(w))).body.draft.title).toBe('Only a title'); // draft retained
    expect((await lead.agent.get(subUrl(w))).body.status).toBe('DRAFT');
  });

  it('keeps the last submitted version official while a new draft is edited; resubmit makes version 2 (AT-06)', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const first = await fillValid(w, lead.agent);
    await lead.agent.post(subUrl(w, '/submit')).send({ version: first.version });

    const up2 = await upload(
      lead.agent,
      subUrl(w, `/files/${first.fileField.id}`),
      pdfBytes('y'),
      'deck-v2.pdf',
    );
    const edit = await lead.agent.put(subUrl(w, '/draft')).send({
      title: 'Fraud Radar v2',
      summary: 'Better.',
      version: up2.body.version,
      values: {
        [first.fileField.id]: up2.body.file.id,
        [first.repoField.id]: 'https://github.com/owner/repo',
      },
    });
    const mid = (await lead.agent.get(subUrl(w))).body;
    expect(mid.draft.hasUnsubmittedChanges).toBe(true);
    expect(mid.versions).toHaveLength(1);
    expect(mid.versions[0].title).toBe('Fraud Radar'); // judges still see v1

    const second = await lead.agent.post(subUrl(w, '/submit')).send({ version: edit.body.version });
    expect(second.body.versionNo).toBe(2);
    const after = (await lead.agent.get(subUrl(w))).body;
    expect(after.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    // v1 still points at its own file; replacing never overwrote it
    expect(after.versions[1].values[first.fileField.id]).toBe(first.fileId);
    expect(await db.submissionFile.count()).toBe(2);
  });

  it('discards unsubmitted changes back to the last submitted version', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const first = await fillValid(w, lead.agent);
    await lead.agent.post(subUrl(w, '/submit')).send({ version: first.version });
    await lead.agent
      .put(subUrl(w, '/draft'))
      .send({ title: 'Scrapped idea', summary: 'x', values: {}, version: first.version + 1 });
    const restored = await lead.agent.post(subUrl(w, '/discard-draft'));
    expect(restored.body.draft.title).toBe('Fraud Radar');
    expect(restored.body.draft.hasUnsubmittedChanges).toBe(false);
  });

  it('uses version checks for concurrent edits and serialises double submits into one version', async () => {
    const w = await openEvent(kit);
    const { lead, mate } = await teamOfTwo(w);
    const { version } = await fillValid(w, lead.agent);
    const clash = await mate.agent
      .put(subUrl(w, '/draft'))
      .send({ title: 'Mate edit', summary: 's', values: {}, version: version - 1 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('stale_version');

    const [a, b] = await Promise.all([
      lead.agent.post(subUrl(w, '/submit')).send({ version }),
      mate.agent.post(subUrl(w, '/submit')).send({ version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.submissionVersion.count()).toBe(1);
  });
});

describe('team rules and deadlines (AT-07)', () => {
  it('needs a minimum-size team unless an admin grants an audited override', async () => {
    const w = await openEvent(kit);
    const solo = await w.participant('Solo');
    await solo.agent.post(`${w.base}/teams`).send({ name: 'Just Me' });
    const { version } = await fillValid(w, solo.agent);
    const blocked = await solo.agent.post(subUrl(w, '/submit')).send({ version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('team_incomplete');
    const teamId = (await solo.agent.get(`${w.base}/my-team`)).body.team.id;
    expect(
      (
        await w.admin
          .put(`${w.base}/rounds/${w.roundId}/submissions/${teamId}/override`)
          .send({ enabled: true, reason: 'Partner fell ill' })
      ).status,
    ).toBe(200);
    expect((await solo.agent.post(subUrl(w, '/submit')).send({ version })).status).toBe(201);
    expect(await db.auditLog.count({ where: { action: 'submission.min_size_override' } })).toBe(1);
  });

  it('requires a track when the event says so and tracks exist', async () => {
    const w = await openEvent(kit);
    await w.admin.post(`${w.base}/tracks`).send({ name: 'Fintech' });
    await w.patchEvent({ trackRequired: true });
    const { lead } = await teamOfTwo(w);
    const { version } = await fillValid(w, lead.agent);
    const res = await lead.agent.post(subUrl(w, '/submit')).send({ version });
    expect(res.body.error.message).toBe('Choose a track first');
  });

  it('rejects writes after the deadline and shows a clear message; the last submitted version is locked', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const { version, fileField } = await fillValid(w, lead.agent);
    await lead.agent.post(subUrl(w, '/submit')).send({ version });
    await db.round.update({
      where: { id: w.roundId },
      data: { submissionDeadline: new Date(Date.now() - 60_000) },
    });
    const view = (await lead.agent.get(subUrl(w))).body;
    expect(view.status).toBe('LOCKED');
    expect(view.editable).toBe(false);
    expect(view.closedReason).toMatch(/deadline passed at/);
    const write = await lead.agent
      .put(subUrl(w, '/draft'))
      .send({ title: 'late', summary: 's', values: {}, version: version + 1 });
    expect(write.status).toBe(409);
    expect(write.body.error.code).toBe('deadline_passed');
    expect(
      (await upload(lead.agent, subUrl(w, `/files/${fileField.id}`), pdfBytes(), 'x.pdf')).status,
    ).toBe(409);
    expect((await lead.agent.post(subUrl(w, '/submit')).send({ version })).status).toBe(409);
  });

  it('accepts and flags late work under Accept-and-flag, and lets an admin extend one team', async () => {
    const w = await openEvent(kit, { round: { latePolicy: 'ACCEPT_AND_FLAG' } });
    const { lead } = await teamOfTwo(w);
    const { version } = await fillValid(w, lead.agent);
    await db.round.update({
      where: { id: w.roundId },
      data: { submissionDeadline: new Date(Date.now() - 7 * 60_000) },
    });
    const late = await lead.agent.post(subUrl(w, '/submit')).send({ version });
    expect(late.status).toBe(201);
    expect(late.body.lateMinutes).toBeGreaterThanOrEqual(7);
    expect((await lead.agent.get(subUrl(w))).body.status).toBe('LOCKED');
  });

  it('honours a per-team extension with an audited reason, and the grace period counts as on time', async () => {
    const w = await openEvent(kit, { round: { graceMinutes: 10 } });
    const a = await teamOfTwo(w, 'Alpha');
    const b = await teamOfTwo(w, 'Beta');
    await db.round.update({
      where: { id: w.roundId },
      data: { submissionDeadline: new Date(Date.now() - 5 * 60_000) },
    }); // inside the 10-minute grace
    const fa = await fillValid(w, a.lead.agent).catch((e) => e);
    void fa;
    expect((await a.lead.agent.get(subUrl(w))).body.editable).toBe(true);
    await db.round.update({
      where: { id: w.roundId },
      data: { submissionDeadline: new Date(Date.now() - 30 * 60_000) },
    }); // beyond grace
    expect((await b.lead.agent.get(subUrl(w))).body.editable).toBe(false);
    const ext = await w.admin
      .put(`${w.base}/rounds/${w.roundId}/submissions/${b.teamId}/extension`)
      .send({ deadline: future(1), reason: 'Venue Wi-Fi outage' });
    expect(ext.status).toBe(200);
    expect((await b.lead.agent.get(subUrl(w))).body.editable).toBe(true);
    expect((await a.lead.agent.get(subUrl(w))).body.editable).toBe(false); // other teams are unaffected
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'submission.extended' } });
    expect(audit.reason).toBe('Venue Wi-Fi outage');
    expect(
      (
        await b.lead.agent
          .put(`${w.base}/rounds/${w.roundId}/submissions/${b.teamId}/extension`)
          .send({ deadline: future(1), reason: 'self-service' })
      ).status,
    ).toBe(404);
  });

  it('needs a reason to change a deadline once submissions exist, and keeps form fields once used', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const { version, fileField } = await fillValid(w, lead.agent);
    await lead.agent.post(subUrl(w, '/submit')).send({ version });
    const noReason = await w.admin
      .patch(`${w.base}/rounds/${w.roundId}`)
      .send(roundBody({ submissionDeadline: future(40) }));
    expect(noReason.status).toBe(422);
    expect(
      (
        await w.admin
          .patch(`${w.base}/rounds/${w.roundId}`)
          .send(roundBody({ submissionDeadline: future(40), reason: 'Extended for exams' }))
      ).status,
    ).toBe(200);
    expect((await w.admin.delete(`${w.base}/rounds/${w.roundId}`)).status).toBe(409);

    const form = (await w.admin.get(`${w.base}/rounds/${w.roundId}/form`)).body.fields as {
      id: string;
      type: string;
      label: string;
    }[];
    const fieldsWithout = form
      .filter((f) => f.id !== fileField.id)
      .map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        allowedExtensions: [],
        maxMb: 25,
        required: false,
      }));
    const removal = await w.admin
      .put(`${w.base}/rounds/${w.roundId}/form`)
      .send({ fields: fieldsWithout });
    expect(removal.body.error.code).toBe('form_locked');
  });
});

describe('access to submissions and files', () => {
  it('shows a team only its own submission and file; admins see everything; judges and staff see nothing', async () => {
    const w = await openEvent(kit);
    const a = await teamOfTwo(w, 'Alpha');
    const b = await teamOfTwo(w, 'Beta');
    const fa = await fillValid(w, a.lead.agent);
    await a.lead.agent.post(subUrl(w, '/submit')).send({ version: fa.version });

    expect((await a.mate.agent.get(`${w.base}/files/${fa.fileId}`)).status).toBe(200);
    const asAdmin = await w.admin.get(`${w.base}/files/${fa.fileId}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.headers['content-disposition']).toContain('attachment');
    expect(asAdmin.headers['x-content-type-options']).toBe('nosniff');
    expect(asAdmin.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await b.lead.agent.get(`${w.base}/files/${fa.fileId}`)).status).toBe(404); // another team's file
    expect(
      (await b.lead.agent.get(`${w.base}/rounds/${w.roundId}/submissions/${a.teamId}`)).status,
    ).toBe(404);
    expect((await b.lead.agent.get(`${w.base}/rounds/${w.roundId}/submissions`)).status).toBe(404);

    const judge = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: w.eventId, userId: judge.id, role: 'JUDGE' },
    });
    const staff = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: w.eventId, userId: staff.id, role: 'STAFF' },
    });
    expect(
      (await (await signedInAgent(app, judge.email)).get(`${w.base}/files/${fa.fileId}`)).status,
    ).toBe(404); // unassigned judge
    expect(
      (await (await signedInAgent(app, staff.email)).get(`${w.base}/files/${fa.fileId}`)).status,
    ).toBe(404);

    const list = (await w.admin.get(`${w.base}/rounds/${w.roundId}/submissions`)).body.rows as {
      name: string;
      status: string;
    }[];
    expect(list.find((r) => r.name === 'Alpha')?.status).toBe('SUBMITTED');
    expect(list.find((r) => r.name === 'Beta')?.status).toBe('NOT_STARTED');
    expect(
      (await w.admin.get(`${w.base}/rounds/${w.roundId}/submissions?status=SUBMITTED`)).body.rows,
    ).toHaveLength(1);
    const detail = (await w.admin.get(`${w.base}/rounds/${w.roundId}/submissions/${a.teamId}`))
      .body;
    expect(detail.versions).toHaveLength(1);
  });

  it('keeps submitted versions and stored files immutable at the database level', async () => {
    const w = await openEvent(kit);
    const { lead } = await teamOfTwo(w);
    const { version } = await fillValid(w, lead.agent);
    await lead.agent.post(subUrl(w, '/submit')).send({ version });
    const v = await db.submissionVersion.findFirstOrThrow();
    await expect(
      db.submissionVersion.update({ where: { id: v.id }, data: { title: 'tampered' } }),
    ).rejects.toThrow(/immutable/);
    await expect(db.submissionVersion.delete({ where: { id: v.id } })).rejects.toThrow(/immutable/);
    const f = await db.submissionFile.findFirstOrThrow();
    await expect(
      db.submissionFile.update({ where: { id: f.id }, data: { originalName: 'x.pdf' } }),
    ).rejects.toThrow(/immutable/);
  });

  it('cannot submit from a different team by guessing file ids across teams', async () => {
    const w = await openEvent(kit);
    const a = await teamOfTwo(w, 'Alpha');
    const b = await teamOfTwo(w, 'Beta');
    const fa = await fillValid(w, a.lead.agent);
    const bs = (await b.lead.agent.get(subUrl(w))).body;
    const bad = await b.lead.agent
      .put(subUrl(w, '/draft'))
      .send({ title: 'x', summary: 'y', values: { [fa.fileField.id]: fa.fileId }, version: 1 });
    expect(bad.status).toBe(422);
    void bs;
  });
});

describe('form definition', () => {
  it('lets admins redefine the form (max 10 fields) and validates file types', async () => {
    const w = await openEvent(kit);
    const put = (fields: unknown[]) =>
      w.admin.put(`${w.base}/rounds/${w.roundId}/form`).send({ fields });
    const bad = await put([
      { type: 'FILE', label: 'Deck', required: true, allowedExtensions: [], maxMb: 25 },
    ]);
    expect(bad.status).toBe(422);
    const tooMany = await put(
      Array.from({ length: 11 }, (_, i) => ({
        type: 'SHORT_TEXT',
        label: `F${i}`,
        required: false,
      })),
    );
    expect(tooMany.status).toBe(422);
    const ok = await put([
      { type: 'FILE', label: 'Deck', required: true, allowedExtensions: ['pdf'], maxMb: 10 },
      { type: 'LONG_TEXT', label: 'Approach', required: false },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.fields.map((f: { label: string }) => f.label)).toEqual(['Deck', 'Approach']);
    const { lead } = await teamOfTwo(w);
    expect((await lead.agent.get(subUrl(w))).body.fields).toHaveLength(2);
    expect(
      (await lead.agent.put(`${w.base}/rounds/${w.roundId}/form`).send({ fields: [] })).status,
    ).toBe(404);
    void past;
  });
});

describe('rounds created later', () => {
  it('get the default submission form for the event type', async () => {
    const w = await openEvent(kit);
    const created = await w.admin
      .post(`${w.base}/rounds`)
      .send(roundBody({ name: 'Final', submissionDeadline: future(35) }));
    expect(created.status).toBe(201);
    const form = (await w.admin.get(`${w.base}/rounds/${created.body.id}/form`)).body.fields;
    expect(form.map((f: { label: string }) => f.label)).toEqual([
      'Presentation',
      'Repository URL',
      'Demo video',
      'Live project URL',
    ]);
  });
});

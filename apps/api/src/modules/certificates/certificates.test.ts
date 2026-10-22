import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Response } from 'superagent';
import { PDFDocument } from 'pdf-lib';
import { createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import {
  addJudge,
  closeSubmissions,
  judgedRound,
  openEvent,
  submitProject,
  teamOfTwo,
} from '../../test/world.js';
import { createBrandDocument } from '../../pdf/brand.js';
import { drawFitted } from './render.js';

const kit = createTestKit();
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

type World = Awaited<ReturnType<typeof openEvent>>;
const c = (w: { base: string }, s = '') => `${w.base}/certificates${s}`;
const generate = (w: World, type = 'PARTICIPATION') =>
  w.admin.post(c(w, '/generate?wait=1')).send({ type });
const list = async (w: World, q = '') =>
  (await w.admin.get(c(w, q))).body.certificates as {
    id: string;
    code: string;
    name: string;
    status: string;
    type: string;
    version: number;
    awardText: string | null;
  }[];

async function twoTeams() {
  const w = await openEvent(kit);
  const a = await teamOfTwo(w, 'Alpha');
  const b = await teamOfTwo(w, 'Beta');
  await teamOfTwo(w, 'Idle'); // never submits
  await submitProject(w, a);
  await submitProject(w, b);
  return { w, a, b };
}

async function pdfPages(agentRes: { body: Buffer }) {
  const doc = await PDFDocument.load(agentRes.body);
  return doc.getPageCount();
}
const binary = (r: Response, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (x: Buffer) => chunks.push(x));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('participation certificates (FR-231, FR-232)', () => {
  it('generates one certificate per eligible person: submitted teams only, never removed or disqualified people', async () => {
    const { w, a, b } = await twoTeams();
    await w.admin
      .post(`${w.base}/participants/${b.mate.membershipId}/remove`)
      .send({ reason: 'Duplicate account' });
    await w.admin
      .post(`${w.base}/teams/${a.teamId}/disqualify`)
      .send({ reason: 'Plagiarised project' });
    const eligible = (await w.admin.get(c(w, '/eligibility/PARTICIPATION'))).body;
    expect(eligible.eligible).toBe(1); // only Beta's lead remains eligible
    const res = await generate(w);
    expect(res.status).toBe(202);
    const rows = await list(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Beta Lead',
      type: 'PARTICIPATION',
      status: 'GENERATED',
      version: 1,
    });
    expect(rows[0]!.code).toMatch(/^CERT-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const job = (await w.admin.get(c(w, `/jobs/${res.body.jobId}`))).body;
    expect(job).toMatchObject({ status: 'DONE', total: 1, done: 1, failed: 0 });
  });

  it('never creates duplicates, even when generation runs twice or at the same time (AT-18N)', async () => {
    const { w } = await twoTeams();
    await Promise.all([generate(w), generate(w)]);
    await generate(w);
    expect(await db.certificate.count()).toBe(4);
    expect(new Set((await db.certificate.findMany()).map((x) => x.certificateCode)).size).toBe(4);
    // a database-level guarantee too
    const one = await db.certificate.findFirstOrThrow();
    await expect(
      db.certificate.create({
        data: {
          certificateCode: 'CERT-TEST-0001',
          eventId: one.eventId,
          membershipId: one.membershipId,
          type: one.type,
          awardKey: one.awardKey,
          nameSnapshot: 'Dup',
          pdfKey: 'x',
        },
      }),
    ).rejects.toThrow();
  });

  it('can use check-in as the participation rule, and honours include/exclude decisions with reasons', async () => {
    const { w, a, b } = await twoTeams();
    await w.patchEvent({ certParticipationRule: 'CHECKED_IN' });
    expect((await w.admin.get(c(w, '/eligibility/PARTICIPATION'))).body.eligible).toBe(0);
    await db.checkIn.create({
      data: {
        eventId: w.eventId,
        membershipId: a.lead.membershipId,
        checkedInById: a.lead.membershipId,
      },
    });
    expect((await w.admin.get(c(w, '/eligibility/PARTICIPATION'))).body.eligible).toBe(1);
    expect(
      (
        await w.admin.put(c(w, '/exceptions')).send({
          membershipId: b.lead.membershipId,
          type: 'PARTICIPATION',
          include: true,
          reason: '',
        })
      ).status,
    ).toBe(422);
    await w.admin.put(c(w, '/exceptions')).send({
      membershipId: b.lead.membershipId,
      type: 'PARTICIPATION',
      include: true,
      reason: 'Attended but forgot to check in',
    });
    await w.admin.put(c(w, '/exceptions')).send({
      membershipId: a.lead.membershipId,
      type: 'PARTICIPATION',
      include: false,
      reason: 'Left early without notice',
    });
    await generate(w);
    expect((await list(w)).map((x) => x.name)).toEqual(['Beta Lead']);
    expect(
      await db.auditLog.count({
        where: { action: { in: ['certificate.person_included', 'certificate.person_excluded'] } },
      }),
    ).toBe(2);
  });

  it('renders a real A4 landscape PDF per certificate', async () => {
    const { w } = await twoTeams();
    await generate(w);
    const [first] = await list(w);
    const pdf = await w.admin
      .get(c(w, `/${first!.id}/pdf`))
      .buffer(true)
      .parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/Participation-/);
    const doc = await PDFDocument.load(pdf.body as Buffer);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
    void pdfPages;
  });
});

describe('review, release and download (FR-233..235, AT-18, AT-22)', () => {
  it('keeps certificates private until released, requires the review confirmation, and lets people download only their own', async () => {
    const { w, a, b } = await twoTeams();
    await generate(w);
    const mine = async (p: typeof a.lead) =>
      (await p.agent.get(c(w, '/mine'))).body.certificates as {
        id: string;
        downloadable: boolean;
      }[];
    expect(await mine(a.lead)).toEqual([]);
    const all = await list(w);
    const aLead = all.find((x) => x.name === 'Alpha Lead')!;
    const bLead = all.find((x) => x.name === 'Beta Lead')!;
    expect((await a.lead.agent.get(c(w, `/${aLead.id}/pdf`))).status).toBe(404); // generated but not released
    expect((await w.admin.post(c(w, '/release')).send({ type: 'PARTICIPATION' })).status).toBe(422); // confirmation required
    expect(
      (await w.admin.post(c(w, '/release')).send({ type: 'PARTICIPATION', reviewed: false }))
        .status,
    ).toBe(422);
    const rel = await w.admin
      .post(c(w, '/release'))
      .send({ type: 'PARTICIPATION', reviewed: true });
    expect(rel.body.released).toBe(4);
    expect((await mine(a.lead))[0]).toMatchObject({ downloadable: true });
    const own = await a.lead.agent
      .get(c(w, `/${aLead.id}/pdf`))
      .buffer(true)
      .parse(binary);
    expect(own.status).toBe(200);
    expect(own.headers['content-disposition']).toMatch(/-Participation-Alpha-Lead\.pdf/);
    expect((await a.lead.agent.get(c(w, `/${bLead.id}/pdf`))).status).toBe(404); // another person's certificate
    expect((await b.mate.agent.get(c(w, `/${aLead.id}/pdf`))).status).toBe(404);
    // staff, judges and outsiders cannot list or open anything
    const judge = await addJudge(kit, w, 'J');
    expect((await judge.agent.get(c(w))).status).toBe(404);
    expect((await judge.agent.get(c(w, `/${aLead.id}/pdf`))).status).toBe(404);
    const outsider = await signedInAgent(app, (await createUser(db)).email);
    expect((await outsider.get(c(w, `/${aLead.id}/pdf`))).status).toBe(404);
    expect(
      (await a.lead.agent.post(c(w, '/release')).send({ type: 'PARTICIPATION', reviewed: true }))
        .status,
    ).toBe(404);
    expect(
      (await a.lead.agent.post(c(w, '/generate')).send({ type: 'PARTICIPATION' })).status,
    ).toBe(404);
    // the "My certificates" page spans events
    const global = (await a.lead.agent.get('/api/v1/me/certificates')).body.certificates;
    expect(global).toHaveLength(1);
    expect(global[0]).toMatchObject({ eventName: 'HackSonipat 2026', downloadable: true });
  });

  it('flags people who stop being eligible and blocks release until the flag is acknowledged or the certificate revoked', async () => {
    const { w, a } = await twoTeams();
    await generate(w);
    await w.admin
      .post(`${w.base}/teams/${a.teamId}/disqualify`)
      .send({ reason: 'Plagiarised project' });
    await generate(w); // re-run: nothing new, but holders no longer eligible are flagged
    const flagged = (await list(w)).filter((x) => x.status === 'FLAGGED');
    expect(flagged).toHaveLength(2);
    const blocked = await w.admin
      .post(c(w, '/release'))
      .send({ type: 'PARTICIPATION', reviewed: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('unresolved_flags');
    await w.admin.post(c(w, `/${flagged[0]!.id}/revoke`)).send({ reason: 'Disqualified' });
    await w.admin.post(c(w, `/${flagged[1]!.id}/revoke`)).send({ reason: 'Disqualified' });
    expect(
      (await w.admin.post(c(w, '/release')).send({ type: 'PARTICIPATION', reviewed: true })).body
        .released,
    ).toBe(2); // Beta's two members
  });

  it('revokes with a reason, withdraws the download, and can restore it', async () => {
    const { w, a } = await twoTeams();
    await generate(w);
    await w.admin.post(c(w, '/release')).send({ type: 'PARTICIPATION', reviewed: true });
    const cert = (await list(w)).find((x) => x.name === 'Alpha Lead')!;
    expect((await w.admin.post(c(w, `/${cert.id}/revoke`)).send({ reason: '' })).status).toBe(422);
    await w.admin.post(c(w, `/${cert.id}/revoke`)).send({ reason: 'Ineligible after review' });
    const mine = (await a.lead.agent.get(c(w, '/mine'))).body.certificates[0];
    expect(mine).toMatchObject({ withdrawn: true, downloadable: false });
    expect((await a.lead.agent.get(c(w, `/${cert.id}/pdf`))).status).toBe(404);
    await w.admin.post(c(w, `/${cert.id}/unrevoke`));
    expect((await a.lead.agent.get(c(w, `/${cert.id}/pdf`))).status).toBe(200);
  });
});

describe('name corrections (FR-236, AT-22)', () => {
  it('regenerates under the same certificate ID with a new version when an admin corrects the name', async () => {
    const { w, a } = await twoTeams();
    await generate(w);
    const before = (await list(w)).find((x) => x.name === 'Alpha Lead')!;
    const detail = (await w.admin.get(`${w.base}/participants/${a.lead.membershipId}`)).body;
    await w.admin
      .patch(`${w.base}/participants/${a.lead.membershipId}`)
      .send({ version: detail.registration.version, certificateName: 'Asha Kumari' });
    expect((await list(w)).find((x) => x.id === before.id)!.status).toBe('NEEDS_REGENERATION');
    // a needs-regeneration certificate blocks release of its type
    expect(
      (await w.admin.post(c(w, '/release')).send({ type: 'PARTICIPATION', reviewed: true })).body
        .error.code,
    ).toBe('unresolved_flags');
    const re = await w.admin.post(c(w, `/${before.id}/regenerate`));
    expect(re.body).toMatchObject({
      code: before.code,
      name: 'Asha Kumari',
      version: 2,
      status: 'GENERATED',
    });
    expect(await db.certificate.count({ where: { certificateCode: before.code } })).toBe(1);
  });

  it('lets a participant request a correction after release; approval keeps the ID, bumps the version and stays released', async () => {
    const { w, a } = await twoTeams();
    await generate(w);
    await w.admin.post(c(w, '/release')).send({ type: 'PARTICIPATION', reviewed: true });
    const cert = (await list(w)).find((x) => x.name === 'Alpha Lead')!;
    expect(
      (await a.lead.agent.post(c(w, `/${cert.id}/correction-request`)).send({ name: '' })).status,
    ).toBe(422);
    expect(
      (await a.mate.agent.post(c(w, `/${cert.id}/correction-request`)).send({ name: 'Not Mine' }))
        .status,
    ).toBe(404);
    expect(
      (
        await a.lead.agent
          .post(c(w, `/${cert.id}/correction-request`))
          .send({ name: 'Asha Kumari' })
      ).status,
    ).toBe(201);
    expect(
      (await a.lead.agent.post(c(w, `/${cert.id}/correction-request`)).send({ name: 'Another' }))
        .body.error.code,
    ).toBe('pending');
    const pending = (await w.admin.get(c(w, '/corrections'))).body.corrections[0];
    expect(pending).toMatchObject({
      requestedName: 'Asha Kumari',
      currentName: 'Alpha Lead',
      status: 'PENDING',
    });
    expect(
      (await w.admin.post(c(w, `/corrections/${pending.id}/decide`)).send({ approve: false }))
        .status,
    ).toBe(422); // a decline needs a reason
    expect(
      (await w.admin.post(c(w, `/corrections/${pending.id}/decide`)).send({ approve: true }))
        .status,
    ).toBe(200);
    const after = (await list(w)).find((x) => x.id === cert.id)!;
    expect(after).toMatchObject({
      code: cert.code,
      name: 'Asha Kumari',
      version: 2,
      status: 'RELEASED',
    });
    const doc = (
      await a.lead.agent
        .get(c(w, `/${cert.id}/pdf`))
        .buffer(true)
        .parse(binary)
    ).body as Buffer;
    expect(doc.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await db.registration.findFirstOrThrow({ where: { membershipId: a.lead.membershipId } }))
        .certificateName,
    ).toBe('Asha Kumari');
  });

  it("locks a participant's own details once a certificate exists", async () => {
    const { w, a } = await twoTeams();
    await w.admin.put(`${w.base}/registration`).send({ status: 'CLOSED' });
    expect((await a.lead.agent.get(`${w.base}/registration/me`)).body.editable).toBe(
      'phone_and_certificate_name',
    );
    await generate(w);
    expect((await a.lead.agent.get(`${w.base}/registration/me`)).body.editable).toBe('none');
  });
});

describe('winner certificates (FR-231)', () => {
  it('needs published final results, then awards each member of a winning team with the right text', async () => {
    const s = await judgedRound(kit, {
      teams: {
        Zeta: [
          [10, 10, 5],
          [10, 10, 5],
        ],
        Xray: [
          [8, 7, 4],
          [6, 9, 3],
        ],
        Wolf: [
          [5, 5, 3],
          [5, 5, 3],
        ],
        Quill: [
          [3, 3, 2],
          [3, 3, 2],
        ],
      },
    });
    expect(
      (await s.w.admin.post(c(s.w, '/generate?wait=1')).send({ type: 'WINNER' })).body.error.code,
    ).toBe('results_not_published');
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/approve`);
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/publish`);
    await s.w.admin
      .put(c(s.w, '/templates/WINNER'))
      .send({ fields: [], awardTexts: { '1': 'Grand Champions' } });
    expect((await s.w.admin.post(c(s.w, '/generate?wait=1')).send({ type: 'WINNER' })).status).toBe(
      202,
    );
    const rows = await list(s.w, '?type=WINNER');
    expect(rows).toHaveLength(6); // 3 positions x 2 members
    expect(rows.filter((r) => r.awardText === 'Grand Champions')).toHaveLength(2);
    expect(rows.filter((r) => r.awardText === 'Second Place')).toHaveLength(2);
    expect(rows.find((r) => r.name.startsWith('Quill'))).toBeUndefined(); // fourth place is not a winner
    // winners also get participation certificates via the participation rule
    await s.w.admin.post(c(s.w, '/generate?wait=1')).send({ type: 'PARTICIPATION' });
    expect((await list(s.w, '?type=PARTICIPATION')).length).toBe(8);
  });
});

describe('templates (FR-230)', () => {
  it('validates field placements and awards, rejects bad backgrounds and previews with the longest real name', async () => {
    const w = await openEvent(kit);
    await teamOfTwo(w, 'Quill Squad');
    const bad = await w.admin.put(c(w, '/templates/PARTICIPATION')).send({
      fields: [
        {
          field: 'NAME',
          x: 2,
          y: 0.4,
          font: 'display',
          size: 40,
          color: 'red',
          align: 'center',
          maxWidth: 0.8,
        },
      ],
      awardTexts: {},
    });
    expect(bad.status).toBe(422);
    const dup = await w.admin.put(c(w, '/templates/PARTICIPATION')).send({
      fields: [
        {
          field: 'NAME',
          x: 0.5,
          y: 0.4,
          font: 'display',
          size: 40,
          color: '#000000',
          align: 'center',
          maxWidth: 0.8,
        },
        {
          field: 'NAME',
          x: 0.5,
          y: 0.5,
          font: 'sans',
          size: 20,
          color: '#000000',
          align: 'center',
          maxWidth: 0.8,
        },
      ],
      awardTexts: {},
    });
    expect(dup.status).toBe(422);
    const ok = await w.admin.put(c(w, '/templates/PARTICIPATION')).send({
      fields: [
        {
          field: 'NAME',
          x: 0.5,
          y: 0.45,
          font: 'display',
          size: 44,
          color: '#000000',
          align: 'center',
          maxWidth: 0.8,
        },
      ],
      awardTexts: {},
    });
    expect(ok.status).toBe(200);

    const upload = (bytes: Buffer) =>
      w.admin
        .put(c(w, '/templates/PARTICIPATION/background'))
        .set('Content-Type', 'application/octet-stream')
        .set('X-Filename', 'bg.png')
        .send(bytes);
    expect((await upload(Buffer.from('<html>not an image</html>'))).status).toBe(422);
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(1000, 16);
    png.writeUInt32BE(700, 20);
    const small = await upload(png);
    expect(small.status).toBe(201);
    expect(small.body.warning).toMatch(/smaller than the recommended/);
    expect(
      (await w.participant('Visitor')).agent.put(c(w, '/templates/PARTICIPATION/background'))
        .constructor,
    ).toBeDefined();

    // preview without a usable background falls back after we remove the fake one; use the default design here
    await db.certificateTemplate.update({
      where: { eventId_type: { eventId: w.eventId, type: 'PARTICIPATION' } },
      data: { backgroundKey: null },
    });
    const prev = await w.admin
      .post(c(w, '/templates/PARTICIPATION/preview'))
      .send({ useLongestName: true })
      .buffer(true)
      .parse(binary);
    expect(prev.status).toBe(200);
    expect((prev.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (
        await (
          await w.participant('P2')
        ).agent
          .post(c(w, '/templates/PARTICIPATION/preview'))
          .send({})
      ).status,
    ).toBe(404);
  });

  it('fits long names: shrink to 60% of the size, then wrap to two lines inside the box', async () => {
    const { doc, fonts } = await createBrandDocument();
    const page = doc.addPage([842, 595]);
    const base = {
      field: 'NAME' as const,
      x: 0.5,
      y: 0.45,
      font: 'display' as const,
      size: 44,
      color: '#000000',
      align: 'center' as const,
      maxWidth: 0.5,
    };
    const short = drawFitted(page, 'Asha Kumari', fonts.display, base, 842, 595);
    expect(short).toEqual({ size: 44, lines: 1 });
    const medium = drawFitted(page, 'Venkata Subramanian Iyer', fonts.display, base, 842, 595);
    expect(medium.size).toBeLessThan(44);
    expect(medium.size).toBeGreaterThanOrEqual(44 * 0.6);
    const long = drawFitted(
      page,
      'Venkata Subramanian Lakshmi Narasimhan Iyer Krishnamurthy',
      fonts.display,
      base,
      842,
      595,
    );
    expect(long.lines).toBe(2);
    expect(long.size).toBeGreaterThanOrEqual(44 * 0.6 - 0.5);
    // characters outside the Latin set are replaced, never crash generation
    expect(() => drawFitted(page, 'आशा कुमारी', fonts.display, base, 842, 595)).not.toThrow();
    void closeSubmissions;
  });
});

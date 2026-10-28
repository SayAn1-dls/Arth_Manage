# Change log

Every commit on `v1_runthrough` after the product audit of 28 Oct 2026 adds a line here in the same
commit. Newest first. Format: **date · type(scope) · what changed and why · evidence**. Earlier history is in
`git log`; deviations from the PRD are in `DECISIONS.md`; verification status is in `RELEASE_READINESS.md`.

## Unreleased (audit follow-up, 28 Oct 2026)

Source: the product audit of the merged PR #1 to #3 tree plus the collapsible sidebar, saved as
`PRODUCT_AUDIT_2026-10-28.md`. Findings are numbered A1 to A12 there; statuses are kept current in that file.

- 2026-10-28 · docs(audit) · Corrected a wrong drift row in the audit (FEATURES_V2 does list its own two migrations) and recorded where each A12 fix landed. · n/a
- 2026-10-28 · docs(v2) · `FEATURES_V2.md` and `JUDGE_WORKSPACE.md`: replaced the "changes remain local / nothing pushed" statements, added the normalisation caveat and rate-limit notes, linked D-55, and recorded the 28 Oct re-run (386 API, 69 web, 16 e2e) (A12). · n/a
- 2026-10-28 · docs(deployment) · `DEPLOYMENT.md`: corrected the known-limits list (reminders and public verification exist), documented the optional AI and normalisation settings, the worker's behaviour, the unlimited public certificate endpoint, unauthenticated GitHub calls, and the migration rule from D-58 (A8, A9, A11, A12). · n/a
- 2026-10-28 · docs(readiness) · `RELEASE_READINESS.md`: new section 11 (28 Oct re-audit: verified figures, fixed, open, changed risks); corrected the "not built" list; noted that sections 1 to 10 describe the 22 Oct tree (A12). · n/a
- 2026-10-28 · docs(decisions) · Added D-54 to D-58 (normalisation, AI reading aid, public certificate verification, extended workflow, migration integrity policy) and marked D-03 and D-45 as partly superseded (A2, A9, A12). · n/a
- 2026-10-28 · docs(readme) · README: status now covers PR #3 and the sidebar, links to the audit, change log and V2 docs, and explains how to run the e2e specs (`EMAIL_PROVIDER=console RATE_LIMIT_DISABLED=true`) (A6, A12). · n/a
- 2026-10-28 · docs(audit) · Added `PRODUCT_AUDIT_2026-10-28.md`: evidence, 12 numbered findings with status, functional status, documentation drift, integration points. · n/a
- 2026-10-28 · fix(workspace) · Shortlist notices now use a key derived from the chosen teams (it embedded `Date.now()`, so the unique index never de-duplicated) and go only to members of ACTIVE teams (A3). · new test red (8 notices) then green (2); workspace suite 15/15
- 2026-10-28 · fix(db) · New migration `20261028100000_restore_certificate_event_constraints` re-adds `certificate_member_same_event` and `cert_exception_member_same_event`, dropped by accident in `20261023150259_first_migration` (A1). The migration test gained a fixed must-exist list (6 triggers, 4 constraints) because its generic check excused every dropped rule. · red before, green after; verified on an empty database
- 2026-10-28 · fix(deps) · `npm audit fix` raised `body-parser` out of the vulnerable 2.0.0-2.3.0 range (DoS via trailing bytes after a compressed body, GHSA-27r3-jxmh-p828). Lockfile only (A5). · `npm audit --omit=dev`: 0 vulnerabilities
- 2026-10-28 · style(email) · Ran Prettier on `email/provider.ts` and its test so `npm run format:check` passes repo-wide (it failed on PR #2). · format:check clean
- 2026-10-28 · fix(email) · Fixed 3 TS2532 errors in `email/provider.test.ts` that made `npm run typecheck` fail for the API (A4). · typecheck clean, 2 provider tests pass
- 2026-10-28 · docs(changelog) · Added this log. · n/a

## Already on the branch before the audit

- 2026-10-28 · feat(web) `e8cbf06` · Collapsible, role-aware sidebar for all four roles (shared
  `CollapsibleNav`, per-role and per-event persistence, mobile Menu button). 69 web tests, 16 e2e specs pass.
- 2026-10-27 · feat `89327de` (PR #3) · Expanded admin operations and the judge review workspace
  (`FEATURES_V2.md`, `JUDGE_WORKSPACE.md`).
- 2026-10-25 · feat(email) `b87607a` (PR #2) · HTML email over SMTP with an embedded call-to-action link.
- 2026-10-22 · docs · Release readiness audit for the controlled pilot (`RELEASE_READINESS.md`).

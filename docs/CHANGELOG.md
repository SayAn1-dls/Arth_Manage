# Change log

Every commit on `v1_runthrough` after the product audit of 28 Oct 2026 adds a line here in the same
commit. Newest first. Format: **date · type(scope) · what changed and why · evidence**. Earlier history is in
`git log`; deviations from the PRD are in `DECISIONS.md`; verification status is in `RELEASE_READINESS.md`.

## Unreleased (audit follow-up, 28 Oct 2026)

Source: the product audit of the merged PR #1 to #3 tree plus the collapsible sidebar. Findings are numbered
A1 to A10 in `RELEASE_READINESS.md` section 11.

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

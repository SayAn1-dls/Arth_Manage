# Judge portal additions

## Available locally

1. **Private scratchpad:** one judge-owned note per team assignment/round, separate from team feedback and the note sent to organisers. Auto-saves with optimistic version checks, includes explicit save and unsaved-change warnings. Admin, participant and other-judge requests are denied. Scratchpads are omitted from evaluation/admin DTOs and evaluation PDFs.
2. **Revisit stars:** mark an assigned team in its workspace, then select Only starred teams in the round list. Stars are private to the judge.
3. **Ask Admin:** judge navigation and workspace links open the existing private helpdesk. Requests appear in the admin inbox.
4. **Reading card:** submitted summary, detected repository language, README headings, last repository push, video duration when browser metadata can load, and an optional AI summary. Repository metadata checks use fixed public GitHub API endpoints, bounded timeouts and a 15-minute cache keyed by immutable submitted version. No grading or ranking is generated or used by the scoring engine.
5. **Shortcuts:** 0–9 fills the active criterion when focus is outside editable controls; Tab and Shift+Tab follow the normal field order. N moves to the next team outside inputs and confirmation dialogs. Next/Previous/All teams wait for pending saves. Multi-digit values such as 10 can be entered normally in score fields.
6. **Submission health:** repository public/reachable checks, verified file availability, PDF load status, and direct-video metadata/playability indicators. The source card already displays version and late status. Unknown/provider-blocked links remain explicitly unverified.
7. **Compare mode:** two active, assigned teams, with their submitted materials, decks and the current judge's own evaluations. Read-only. Other judges' scores are not exposed. Panels stack on narrow screens.
8. **Glossary:** admins add terms and definitions for an event or a selected track in Judge briefing & glossary. Terms are keyboard-focusable and show hover/focus definitions in summaries, rubric descriptions and compare summaries. Embedded PDF content is not rewritten.
9. **Pinned briefing:** rubric explanation, fictional scored examples, shortcut help and organiser contact. Admin edits use optimistic locking; judges have read access.
10. **Personal export:** PDF containing only the signed-in judge's saved evaluations, score breakdowns, team comments and notes they sent to organisers. Draft/submitted status and assignment status are shown. No other judge's work or scratchpad is included.
11. **Practice team:** fictional RiverWatch submission and a copy of an active event rubric, or a default practice rubric if none exists. Practice notes, stars, scores and submission state stay in browser memory. It cannot write a real evaluation.

## Optional AI setup

The integration follows OpenAI's structured Responses output format:
https://developers.openai.com/api/docs/guides/structured-outputs

Set these only in the ignored root `.env`, then restart `npm run dev`:

```dotenv
OPENAI_API_KEY=your-server-side-key
JUDGE_SUMMARY_MODEL=your-supported-model-id
JUDGE_AI_ENABLED=true
```

No model is silently selected. Choose a model supported by your OpenAI account. Keys are never sent to the browser or stored in the database. Enabling this explicitly allows project titles, submitted summary text, repository language and public README excerpts to be sent to OpenAI on request. Scores, scratchpads, organiser notes and participant records are not part of that input. Requests set `store: false`, use a strict three-field schema, have a timeout and output-token limit, and handle refused/incomplete/unavailable outputs with a source-only fallback.

AI remains **off by default** and is recorded as DECISIONS D-55, which supersedes the earlier "no AI in V1" decision (D-03). Without credentials, the source-based reading card works and states that AI is not configured. Real OpenAI calls have not been exercised; provider behavior was tested with a mocked response.

## Video and link limits

- Public GitHub repositories are checked without a token, subject to GitHub rate limits. Private repositories are reported as not public or not found; no public badge is fabricated.
- Direct MP4/WebM/Ogg/MOV links use browser metadata and `canplay` events. Provider pages such as YouTube/Vimeo remain unverified and must be opened on the provider site. No provider API credentials were supplied, so their video lengths are not guessed.
- File availability checks read the actual version-referenced stored file. A preview load event is shown separately from storage availability. Checks are time-stamped and cached for 15 minutes.

## Validation

- Nine new API tests: scratchpad ownership, stale-write rejection, star filtering, event isolation and unassignment, admin-only briefing/glossary changes, practice isolation, judge helpdesk, version-specific evidence/file checks, own-only PDF exports and structured AI request/output handling.
- Existing judging/evaluation suites: 26 tests passed.
- Web suite: 38 tests passed, including six new scratchpad, media, glossary and keyboard/save-before-navigation tests.
- Production build, TypeScript checks, ESLint, brand lint, formatting and whitespace checks.
- Browser inspection as seeded judge `judge1@arthakram.test`: navigation, team list, evaluation workspace, reading card, file status and comparison controls.

The additive migration `20261027160000_judge_workspace` has been applied to the local development and test databases. Earlier local changes have been preserved. Merged to `main` as PR #3 (2026-10-28); nothing has been deployed. On a database that predates the merge run `npm run db:deploy -w @arthakram/api` first.

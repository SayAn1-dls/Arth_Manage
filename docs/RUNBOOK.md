# Event-day runbook and operations

For the people running a live event. Commands assume the repository root and a configured `.env`.

## 1. Before the event

* [ ] Registration open, rounds and deadlines correct in the event time zone (Setup, Rounds).
* [ ] Guidebook published; announcements drafted.
* [ ] Rubric activated for each round (Rubric). Judges invited and accepted (People).
* [ ] Staff invited; tasks created; check-in tested on a phone.
* [ ] Email works: register a throwaway account and confirm the verification email arrives.
* [ ] Backup taken and a restore rehearsed at least once (section 4).
* [ ] (Optional) Google connected, a sync succeeded, spreadsheet opens.

## 2. During the event

| Moment | Action |
|---|---|
| Check-in | Staff: Check-in screen, search team, mark each member present. ID verification is a separate step. |
| Something broke | Staff: Report an issue (mark urgent if blocking). Admin: Issues queue, Resolve with a note. |
| Submission deadline | The server decides. A team that is late sees a clear message; grant an extension in Submissions (reason required). **Take a database backup right after the deadline.** |
| Judging | Assign judges, open judging. Dashboard shows progress; reopen an evaluation only with a reason. |
| Results | Results screen: fix ties (reason required), Approve, **back up**, Publish. Changing inputs afterwards withdraws the approval automatically. |
| After | Open feedback; release judge comments; generate, review and release certificates. |

## 3. When things go wrong

| Symptom | Likely cause and fix |
|---|---|
| Nobody receives emails | SMTP misconfigured. Check logs for `email` errors; fix `SMTP_URL`; people can use "Resend" and "Forgot password". |
| Users cannot sign in repeatedly | Account locked 15 minutes after 5 failures; reset password email unlocks. |
| Sheets shows "Needs reconnecting" | Google access was revoked. Integrations > Reconnect. CSV export works meanwhile. |
| Sheets "spreadsheet can't be found" | It was deleted. Integrations > Create a new spreadsheet. |
| Sync stuck as running after a crash | Jobs left running for 10 minutes return to the queue on the next start. |
| A certificate has the wrong name | Admin edits the certificate name (participant detail) or approves a correction request; regenerate keeps the same ID. |
| Results look stale | Reopen the Results screen; a changed input shows the approval as withdrawn until re-approved. |
| Database unreachable | `/api/v1/health` shows `database: down`. Restore connectivity; the API reconnects without restart. |

Logs are JSON on stdout (pino). Secrets and tokens are never logged; passwords are never stored in plain text.

## 4. Backup and restore

PostgreSQL holds everything except uploaded files (`STORAGE_DIR`).

```bash
# Backup (database + files)
pg_dump --format=custom --file=arthakram-$(date +%F-%H%M).dump "$DATABASE_URL"
tar -czf uploads-$(date +%F-%H%M).tgz "$STORAGE_DIR"

# Restore into an empty database
createdb arthakram_restore
pg_restore --no-owner --dbname=arthakram_restore arthakram-YYYY-MM-DD-HHMM.dump
tar -xzf uploads-YYYY-MM-DD-HHMM.tgz -C "$(dirname "$STORAGE_DIR")"
# then point DATABASE_URL at arthakram_restore and start the app
```

Policy to follow (PRD 11.3): automatic daily database backups kept 30 days, plus manual backups right
after the submission deadline and after result approval. Test a restore before the pilot. The audit log
is part of the database and is restored with it; it cannot be edited by the app.

## 5. After the event

Conclude the event (closes registration, read-only except feedback and certificates), export CSVs you
need (participants, teams, results, feedback, certificates, audit), then archive when finished. Retention
and deletion rules are not decided yet (PRD OQ-15): do not delete data until they are.

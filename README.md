# Debenhams advisor scheduler

A weekly shift scheduler for up to 500 people. React front end, Node.js + Express back end, MongoDB database.
You enter how many advisors each group needs; the app builds the week's roster from those numbers.

## Run it

Requirements: Node 20+, Docker (for MongoDB).

```bash
npm install                      # installs server and client (npm workspaces)
npm run db                       # starts MongoDB as a single-node replica set (needed for transactions)
npm run dev:server               # API on http://localhost:4000
npm run dev:client               # web app on http://localhost:5173
```

On Windows PowerShell, copy the environment file with:

```powershell
Copy-Item server/.env.example server/.env
```

Then set `JWT_SECRET` in `server/.env` to a long random string before starting the server.

Optional demo data (about 50 people, a staffing template, setup already complete; **it wipes the database**):

```bash
npm run seed                     # demo login: manager@example.com / changeme123
```

Without the seed, open the web app: the first visit asks you to create the manager account, then you add people (setup),
then you finish setup to unlock the scheduler.

Tests for the auto-scheduler and rules: `npm test`.

## How it works

**People and teams.** Designations: Advisor, Team Leader, QA, Trainer, Management. Advisors have a segment (eGain, Sentiment, Mirakl).
A team leader's team number is the team name; each team leader has a classification: Mirakl, Karen Millen or Normal (= Debenhams).
Mirakl advisors can only sit under Mirakl team leaders and Mirakl team leaders only have Mirakl advisors. Classification changes
and moves that would break this are blocked until advisors are reassigned.

**Setup is one time.** The scheduler stays locked until you finish setup. After that you can add, edit and remove people.
Removing a person is a soft delete: they leave the 500 count and future schedules, past rosters keep their name.
The 500 cap is enforced on the server with an atomic counter inside a transaction, including for CSV import.

**Groups.** Home group = segment + team leader classification: Mirakl, eGain – Debenhams, eGain – Karen Millen,
Sentiment – Debenhams, Sentiment – Karen Millen. Each schedule entry also records the *work group* for that day.

**Staffing needs.** For every group, shift and weekday you set a minimum, target and maximum (simple mode: one number = target).
There is a default weekly template; any single week can have its own numbers. The two Debenhams groups default to no maximum.

**Auto-scheduler** (server/src/lib/autoScheduler.ts), run as a preview first, then applied:
1. Weekly days off are placed on the quietest days (default 2, consecutive where possible).
2. Segment priority: advisors fill their own group's minimum first (Sentiment on Sentiment, eGain on eGain).
3. Business need: a group still below minimum borrows from the other non-Mirakl segment. Mirakl never moves in or out.
4. Groups are raised towards target.
5. Leftover advisors go to the Debenhams group of their own segment, up to its maximum.
6. Anyone still unplaced is reported as surplus.
Rest between shifts, working days in a row, and shift rotation look across week boundaries (a Sunday 22:00 shift blocks a Monday 07:00 start).
Locked cells, leave and days off set by hand are never changed. Teams are kept on the same shift where possible.

**Team leaders** follow their team: the same shift as the team's advisors, automatically. Only Off/Leave can be set by hand.
Their days off are placed on the days the team is quietest.
**QA, Trainers and Management** have the fixed 14:30–22:30 shift on the working weekdays set under Settings (default Mon–Fri).

**Shifts.** Advisor starts: 07:00, 08:00, 09:00, 11:30, 12:30, 22:00 (IST; 22:00 ends the next morning). Shift length is 8 hours.
Overtime is added per advisor per day in 0.5-hour steps up to 5 hours (8 to 13 hours in total).

**Swaps.** There is no swap workflow: advisors agree swaps themselves and the manager edits the two cells. Warnings update immediately.

## Notes for developers

- Shared constants and date helpers: `shared/domain.ts`. Dates are IST `YYYY-MM-DD` strings; shift times are computed in code.
- Shifts are constants in `shared/domain.ts` (single source of truth), not a database collection.
- Collections: users, settings, people, teams, scheduleentries, staffingrequirements (indexes in `server/src/models.ts`).
- Export is CSV (opens in Excel). The browser stores only the login token.
- Not included: published/draft weeks, change log, roles beyond one manager role, holiday calendar, shift-swap or leave-request workflows.

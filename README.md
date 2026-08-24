# Hyperion

A self-hosted career record built on one idea: **everything is a dated event on a single
axis.** A Position is a job held, an Application is a job pursued, and Landing an
Application turns it into a Position — so your job history is what the application tracker
produces over time, rather than a second thing to maintain beside it.

It answers one question: *what I've done, what it paid, and what I'm going after next.*

Part of the Saturn suite, alongside Prometheus (household finance) and Atlas (fitness) —
three apps sharing a self-hosting philosophy, a demo-build pattern and a vocabulary
discipline.

## Why it exists

Two problems, usually solved by two bad spreadsheets.

The first is the job hunt: postings, application dates, résumé versions, interview notes
and follow-ups scattered across tabs, email threads and a sheet nobody maintains past week
three. The second is quieter and more expensive — **nobody remembers what they did at
work.** When the performance review comes round in March, the thing you shipped last May is
gone, and the raise conversation happens without evidence.

They are the same problem: no durable record of your working life. Most trackers run into
the same wall, which is that you land a job and never open the app again. The fix here is
not better retention mechanics but a wider scope — the app holds the whole working life,
not one search.

## What it holds

The spine is the **Position** — one continuous stint at one employer. Everything else hangs
off it, dated:

- **Standing Terms** — what a Position pays as of a date, superseded by the next set
- **Payments** — money that actually arrived: a bonus, later an equity tranche
- **Achievements** — what you did, when, and what it changed
- **Applications** and their **Events** — the pipeline, and where every response-time figure
  comes from

Merge those and you have the timeline, which is the app's central view.

A few consequences are decisions rather than details, and they are most of what makes the
model hold together:

- **A promotion is an event on a Position, not a new Position.** Your time at a company is
  one stint; the title changes recorded against it are what a résumé renders as nested roles.
- **Status is derived, never stored.** An application's stage is the stage of its most recent
  event. Storing it alongside the event log invites the two to disagree.
- **Standing Terms and Payments are separate tables.** Terms supersede; payments accumulate.
  Opposite arithmetic, so no invalid state is representable and nothing can accidentally sum
  two raises.
- **Currency belongs to the amount, not the deployment.** A career that crosses a border is
  an ordinary shape here, not an edge case.

[`CONTEXT.md`](CONTEXT.md) defines every term precisely, each with a list of words to avoid.
[`hyperion-plan.md`](hyperion-plan.md) is the design record: what was built, what was
deliberately not, and why — including the arguments that were lost.

## Principles

**Hyperion holds only what you put into it.** No scraping, no job-board aggregation, no
salary benchmarks, no inflation series, no live equity prices, no exchange rate feeds. Every
number on screen traces to a row somebody typed. This one rule settles a whole class of
questions at once, and it is why several obvious-sounding features are absent.

**It is a record, not an advisor.** It computes things about your own data. It does not tell
you whether you are underpaid or when to leave.

**It never interrupts.** No scheduler, no cron, no SMTP, no push notifications — none of the
operational surface that comes with software running while nobody is looking. It shows you
state when you open it.

**AI is additive, never load-bearing.** Every core function works with no API key and no
network. The AI features — a self-assessment draft from six months of achievements, and
résumé bullets — are an enhancement layer behind a key you supply.

**If it will land in free text anyway, it does not need a column.** This has removed more
from the plan than any other principle.

## Running it

Self-hosting should be an evening, not a project:

```bash
docker compose up -d
```

Then open http://localhost:8080. There is no account yet, and the container's logs print a
one-time setup token to create the first one — `docker compose logs` it, open `/setup`, and enter
the token with a display name and password. That first account is the Admin, and the setup route
closes for good the moment it exists.

After that, registration is invite-only: the Admin generates a single-use code in Settings and hands
over the code or the `/register?code=…` link it copies. Settings also lists every account to an
Admin, with a password reset per row — there is no email anywhere in this app, so that reset is the
only way back in for somebody who forgets.

One container, one process, one SQLite file — the volume is the whole of the deployment's state, and
`cp hyperion.db` is a complete backup. Exporting your data from Settings is the portable half of
that story: a zip of every row as JSON plus your documents' actual files.

Keep it off the public internet. Auth here separates the people sharing a deployment from
each other, not from the internet.

### Development

```bash
npm install
npm run dev
```

Runs against `localStorage` with no server and no login. `npm test` runs the suite;
`npm run typecheck` runs `vue-tsc`.

There is also a demo build — `npm run build:demo` — which seeds a fictional persona and
opens on a login facade. It is the version to show someone. It writes `dist-demo/` and is a static
site with nothing behind it, so any static host will serve it; `vercel.json` carries the build
command, the output directory, and the one rewrite a client-side router needs — without it a hard
refresh on `/applications` asks the host for a file that does not exist and gets a 404.

## How the code is arranged

| | |
|---|---|
| `domain/` | the engine — timeline assembly, compensation math, tenure, pipeline statistics. No framework imports and no I/O, so every rule is testable on its own. |
| `storage/` | the port, expressed in domain operations, and its two adapters: SQLite over HTTP, and `localStorage`. One contract suite runs against both. |
| `ui/` | Vue 3. Views, and nothing that decides anything. |
| `server/` | static files plus row-level CRUD, holding no domain knowledge on purpose. |

**Identity lives at the boundary, never in the domain.** `domain/` does not know what a User
is; it receives rows and computes over them. Scoping happens in `storage/` and `server/`,
which hand the engine only the signed-in User's data — so every domain test is free of auth
fixtures.

Four runtime dependencies: Vue, Vue Router, `better-sqlite3` and `@node-rs/argon2`. The ZIP
writer, the exchange-rate arithmetic and the AI client are all hand-rolled, each because a
library would have cost more than the code it replaced.

## Deliberately not built

Named so they stop coming back up: job-board aggregation, deriving achievements from pull
requests and tickets (that means exporting company data onto your own hardware), a personal
CRM, campaigns, offer comparison as a separate feature, email status detection, tags on
achievements, notifications of any kind, salary benchmarking, OKR frameworks, and sharing
between Users.

`hyperion-plan.md` carries the reasoning for each, and for the ones that were dropped after
being planned.

## Status

Built, and in daily use on real data. Every feature the plan set out is shipped; what is left in it
is a short list of things that want time and real use to answer, not code.

Equity is the one shape the model holds room for without holding data — grants as dated tranches,
vested tranches becoming Payments. It is designed and deliberately not built: a total compensation
with no grants in it is complete rather than missing something, and there is no equity here to
record.

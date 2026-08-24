# Hyperion

A self-hosted career record built on the **timeline model**: everything Hyperion holds is a dated
event on one axis — jobs started and ended, raises taken, achievements logged, applications sent
and answered. Part of the Saturn suite, alongside Prometheus (household finance) and Atlas
(fitness).

It answers one question: **what I've done, what it paid, and what I'm going after next.**

## Motivation

Two problems, usually solved by two bad spreadsheets.

The first is the job hunt. Postings, application dates, résumé versions, interview notes and
follow-ups end up scattered across tabs, email threads and a sheet nobody maintains past week
three. The second is quieter and more expensive: nobody remembers what they did at work. When the
performance review comes round in March, the thing you shipped last May is gone, and the raise
conversation happens without evidence.

They are the same problem — no durable record of your working life — and the two halves meet at
**Landing**. An application that produces an offer becomes a position, which means job history is
what the application tracker produces over time rather than a second thing to maintain. That is the
link, and it is the only one the early work claims.

The larger ambition is a full loop — achievements logged at work becoming résumé bullets that feed
the next application — and it is worth building. But it arrives later, and this plan does not
pretend otherwise.

## Design principles

**Personal tool first.**
Hyperion is built to be used daily on real data, and its portfolio value follows from that rather
than competing with it. Where the two conflict — surface area against usefulness, breadth against
the three screens actually opened every day — usefulness wins. The strongest thing that can be said
about a side project is that it has been in daily use for a year, and that sentence is unavailable
to something built for the demo.

**Hyperion holds only what you put into it.**
No scraping, no job-board aggregation, no salary benchmarks, no inflation series, no live equity
prices, no exchange rate feeds. Every number on screen traces to a row somebody typed. This is the
rule that settles a whole class of questions at once, and it is why several obvious-sounding
features are absent below. The cost is real — a compensation chart spanning eight years flatters
you, because some of that curve is just the currency — and the mitigation is to not editorialise.
Show what you were paid and when, mark the raises and promotions on the timeline, and let it be a
record rather than a verdict.

**It is a record, not an advisor.**
Hyperion computes things about your own data. It does not tell you whether you are underpaid, what
you should earn, or when to leave. Prometheus draws the same line by calling itself a share
calculator and refusing to track who paid.

**Hyperion never interrupts you.**
It shows you state when you open it, and it never pushes. No scheduler, no cron, no SMTP, no push
notifications, no service worker — none of the operational surface that comes with software running
while nobody is looking. Where a prompt seems wanted, a passive signal on screen does the job
without training you to dismiss it. The one genuinely time-critical thing in a job search is an
interview tomorrow, and your calendar already owns that; Hyperion showing it is a convenience beside
the record, never the alarm anybody relies on.

**If it will land in free text anyway, it does not need a column.**
Details a person will naturally write into an achievement, a note or an interview answer do not need
modelling. Which client you worked for at a consultancy, which recruiter was pleasant, what the
office was like — all of it belongs in prose written once, not in a field maintained forever. This
principle has removed more from this plan than any other.

**AI is additive, never load-bearing.**
Every core function — the record, the timeline, the numbers, search — works with no API key and no
network. AI features are an enhancement layer gated behind a key the user supplies, and they stay
visible but inactive when there isn't one.

**Several people, one deployment, still not internet-facing.**
Hyperion is the one app in the suite with accounts, because it is the one holding data that is
per-person rather than shared. Prometheus is multi-member and single-tenant deliberately — a
household's finances belong to the household — and Atlas is one person. Two people sharing a
Hyperion deployment must not see each other's compensation or notes, which is a requirement neither
sibling has.

Auth here separates housemates; it does not defend against the internet. A hand-rolled login on a
public VPS wants rate limiting, lockout, CSRF handling, session-fixation defence and a reset flow —
a far higher bar than a LAN app with no login at all. So the deployment stance is unchanged: one
container, one SQLite file, backup by copying the file, kept on your own network or behind whatever
reverse proxy you already run.

## The model

The spine is the **Position** — a job you hold or held, one continuous stint at one employer. An
**Application** is a prospective Position, and **Landing** one mints the Position from it, carrying
the company, the title and the offered terms across.

Everything else hangs off those two, dated:

- **Standing Terms** — what a Position pays as of a date, superseded by the next set
- **Payments** — money that actually arrived: a bonus, later an equity tranche
- **Achievements** — what you did, when, and what it changed
- **Application Events** — the application entering a stage, which is where every response-time
  figure eventually comes from

Merge those and you have the timeline, which is the app's central view.

Five consequences worth stating, because they are decisions rather than details:

**A Position Event is either Standing Terms or a Payment, and they are stored separately.** A raise
changes what the Position pays from that date forward; a bonus is money that arrived once and
changes nothing. Terms supersede, payments accumulate, and the two are handled by opposite
arithmetic — so they get two tables rather than one table with a discriminator and half its columns
null on every row. No invalid state is representable, and nothing can accidentally sum two raises.
**Position Event** survives as the umbrella concept, assembled from both, exactly as the timeline is
assembled from rows it does not own.

**Employment type lives on Standing Terms.** A PJ→CLT conversion at the same employer is an event,
not a new Position — tenure stays whole, the gross figure changes for a visible reason, and a CV
does not report one job as two short stints.

**Status is derived, never stored.** An application's stage is the stage of its most recent event.
Storing it as a field alongside the event log invites the two to disagree.

**A promotion is an event on a Position, not a new Position.** Your time at a company is one
Position; the title changes recorded against it are what a résumé renders as nested roles.

**Currency belongs to the amount, not to the deployment.** A Position carries the currency it pays in
and its events inherit it, so every view of one Position's history reads natively with nothing
converted. A career that crosses a border is an ordinary shape, not an edge case.

`CONTEXT.md` defines every term precisely, each with a list of words to avoid.

## Users and access

Every domain row belongs to a User, and Users see only their own. That is the whole of it: Hyperion
is **multi-tenant, not collaborative**. No sharing, no visibility between Users, no comparison, and
no permissions model beyond the single bit marking an Admin. The moment a sharing feature exists
there is an ACL, and an ACL is a great deal of work for a benefit nobody here asked for.

**What splits how.** Everything domain is per-User, as are the fold threshold, the stall threshold
and the LLM API key,
which is that person's key and that person's spend. Almost nothing is deployment-wide.

**Scoping is day one; authentication is not.** `user_id` sits on every domain table from the first
migration and the storage adapter filters by it from the first commit — that is the part which is
free now and a miserable migration later. The login itself comes at the end of the first build, with
the app running against a hardcoded current User until then. Because identity lives at the boundary
rather than in the domain, *authorisation* never changes and only *authentication* is stubbed, which
is a far smaller seam than the usual "we'll add auth later".

**Accounts are created by invitation.** First run creates the first User, who is the Admin; after
that an Admin generates a single-use invite code and hands it over. Registration is never open. This
buys nothing on a private network — anyone who can reach Hyperion could already reach Prometheus,
which has no login at all — but Hyperion is public code that other people will deploy, and some of
them will put it on a VPS. Invite-only means that deployment fails safe, where an open signup form
found by a scanner does not.

**The first-run window closes with a setup token** printed to the container logs, which the first
account must present. Between `docker compose up` and somebody reaching the page, whoever arrives
first would otherwise own the instance.

**Sessions in a cookie, not JWT.** Same origin, one server, no stateless scaling requirement, so
reaching for a token format that solves a problem Hyperion does not have would be cargo cult.
Argon2id for hashing.

**No email-based password reset.** That needs SMTP, which the app does not have and will not get. An
Admin resets other Users' passwords — built, and reachable from Settings, which also invalidates that
User's Sessions. The Admin's own reset was to be "a command run against the SQLite file"; **that
command was never written**, so a sole Admin who forgets their password currently has no route back
in short of editing the database by hand. Known gap, not a decision.

## Feature set

### 1. The career record

Positions with their Standing Terms and Payments, and the achievement log. This is the half that is
genuinely differentiated and the half still in use in three years, so it comes first.

The achievement log is the highest-value, lowest-effort thing in the app: dated entries with an
optional impact figure, because performance reviews are recall problems rather than writing problems.

**Capture is a design constraint, not a feature.** One always-visible input on the home screen — type
a line, press enter, done. The date is today, the position is the current one, everything else is
optional and editable later. If the fastest path to logging an achievement is a form with five
fields, the log stays empty, and an empty log takes half the app down with it. Nothing about capture
may become more elaborate than one box.

**Retrieval is full-text search**, which SQLite gives for nothing via FTS5.

**A passive staleness signal, not a nudge.** The home screen quietly states *last logged: 6 weeks
ago*. No prompt, no cadence, nothing to dismiss — achievements happen perhaps twice a month, and a
weekly prompt answered "nothing" trains you to ignore the app. A fact on screen is consistent with
Hyperion being a record, and with it never interrupting.

### 2. Timeline

One dated axis carrying Positions as spans and their Standing Terms changes, Payments and Departures
as points — Positions only, not Achievements, which stay on their own log. The view that makes the
two halves of the app look like one app.

### 3. Compensation history

Total compensation reconstructed per year from base salary and target bonus — a figure almost nobody
can state accurately about their own past.

Derived, all of it from your own rows:

- **Total compensation** per position and per year
- **Switch premium vs. stay premium** — what changing jobs got you against what internal raises got
  you. The most actionable number in the app.
- Time since last raise, tenure, growth rate per position

### 4. Self-assessment draft (AI, user-supplied key)

Six months of achievement entries into a draft you would actually hand to a manager.

This sits early rather than in a late AI phase, because it is the answer to the achievement log's
real risk. Logging has a six-month feedback loop — you write in May and the payoff is in November —
and habits with six-month payoffs do not form. The self-assessment generator collapses that: log an
entry, and you can immediately see it feeding a document. Nothing else in the plan closes that loop.

It is also the most demonstrable thing in the app. "Here is six months of scrappy notes, here is the
review draft it produces" is a better thirty seconds than any chart.

### 5. The application record

Applications, their event logs, the résumé sent with each, and **Landing**.

An Application carries two distinct sets of figures, and conflating them loses one: the **advertised
range** the posting claimed, and the **offered terms** they actually put in writing. Landing needs
the second to mint the Position's Starting Terms.

Offered terms also make offer comparison a non-feature: comparing an offer against your current job
is your current Standing Terms rendered beside the offered ones, and two offers at once is two
applications at the Offer stage, which any list already shows.

**Documents are stored, not merely labelled** — the actual résumé file, as a blob in SQLite. Three
years and two laptops later, "the PDF is in a folder somewhere" is optimistic, and being asked about
a CV you sent is a real interview moment. Blobs rather than a volume keep `cp hyperion.db` a complete
backup, which is the property making the whole self-hosted story trustworthy, and mean a row and its
bytes cannot drift apart. Individual documents download normally; the whole-app export becomes a
**zip** of JSON plus files rather than plain JSON, so "export everything" stays true.

**`prior_application_id` exists from the start**, unused. The column is migration-hostile and free
now; the check that populates it belongs with the search analytics below, since it does nothing until
there is a corpus to check against.

### 6. The rest of the AI layer

- **Achievements → résumé bullets**, the first half of the loop the motivation describes —
  **shipped**, below, and now the whole of this section. Gap analysis and cover letter drafting were
  the other two; both were dropped 2026-08-20 (§ Deliberately not building). With § 4's
  self-assessment — the piece that sits outside this section rather than in it, early by design — the
  AI layer is therefore finished: two views, `SelfAssessmentView.vue` and `ResumeBulletsView.vue`,
  over one shared AI Setup section in `SettingsView.vue`.

### 7. When a search starts

Everything here is analytics over a live pipeline. None of it can be tuned against zero applications
in flight — a stall threshold in particular is a number you can only learn by watching real
applications go quiet — so it waits until there is a search to watch.

- **Rounds** — the steps a company actually put you through, one entry each: a date, a kind (Interview
  or Take-home — coarse on purpose, matching the free-text notes decision: which flavor of interview
  it was lives in the debrief, not a second field), who if anyone, and a debrief afterwards. Distinct
  from Stage, because a Round can be scheduled for the future where the event log cannot, and because
  several ordinarily sit under one Stage (CONTEXT.md § Round). Deliberately one entity rather than
  separate Interview and Assessment types: a live pair-programming session is a conversation and a
  test at once, and the two would behave identically anyway. The one item in this section not waiting
  on a live pipeline to tune against, since it is a record rather than an analytic — **shipped**,
  below, same day it was settled.
- **Prior-application awareness** — the notice when you have history with a company, populating the
  column reserved above. Applying again is legitimate and often sensible, so it is context and never
  a block; only an Open application to the same posting is worth raising a voice for. Another item not
  actually waiting on a live pipeline to tune against — **shipped**, below, once real Applications
  existed to have history with.
- **The funnel**, response rates and time-to-response — **shipped**, below, ahead of the real-search
  volume the numbers will actually need to mean much — by direct request, mechanism now rather than
  later.
- **Stall detection** and the attention view — **shipped**, below. The one item in this section that
  really did need to wait: the mechanism needed no tuning to build, but the threshold's default
  (21 days) is only as good as a guess until watched against real applications going quiet.

### 8. Currency conversion

**Shipped**, below.

A comparison spanning two currencies needs a common unit, and the principles above rule out a rate
feed — so Hyperion asks for the rate it needs, at the moment it first needs it, and remembers the
answer:

> To compare your 2023 position (BRL) against your 2025 position (USD), Hyperion needs a rate for
> 2025-03. Enter one: `1 USD = ____ BRL`

No table to fill in upfront, and no rate invented on your behalf. Two rules keep it honest: the
native-currency view is always the default, and anything converted is labelled as converted, with the
rate and its date beside it rather than folded silently into a total.

Worth saying plainly, since it is the reason to want any of this: converting a São Paulo salary into
dollars says very little about whether you are better off, because cost of living dominates and no
exchange rate captures it. That judgement is yours. Hyperion shows the rate it used and stops there.

### 9. Equity

Grants recorded at their value when made, with vesting stored as **dated tranches** rather than as
schedule shapes — any schedule reduces to a list of dates and amounts, and a form with the usual
presets can generate them. Vested tranches are Payments. Total compensation for a year then includes
what actually vested during it, which is the true figure: a refresher granted in March with a
one-year cliff contributes nothing that year, while dividing each grant by its length would count
money nobody has received.

Deferred because the core comes first — there is no equity in the record today, and the definition in
`CONTEXT.md` already accommodates it, so a total comp with no equity grants in it is simply complete.

## Deliberately not building

Named here so they stop coming back up:

- **Job board aggregation.** A maintenance treadmill, legally grey, and better served by the boards
  themselves. Discovery is the one part of job hunting that is not broken.
- **PR and issue import.** Deriving achievements from merged pull requests and closed tickets is the
  most appealing idea in this space, and it is disqualified outright: pulling Jira tickets or
  private-repo contents into a personal, self-hosted system means exporting company data onto your
  own hardware, which plenty of employment contracts and infosec policies prohibit. Not deferred —
  ruled out.
- **Contacts.** A personal CRM nobody keeps current, competing with LinkedIn, which is maintained by
  the contacts themselves. Who you spoke to goes in the interview notes written anyway, and search
  finds it.
- **A Search entity.** Grouping applications into named campaigns assumes discrete bursts of hunting.
  Openings arrive continuously — something you found, something a recruiter sent — and a date range
  answers "how did last year go" without asking you to declare a boundary that does not exist.
  **Source** is the dimension actually worth comparing.
- **Offer comparison as a feature.** A rare event, and the one time it happens you will think hard on
  paper about things Hyperion does not hold. Offered terms beside current terms is the whole of it.
- **Email status detection.** Watching an inbox to infer stage changes cannot be tuned against
  applications you have not received; it is far larger than it reads — IMAP handling, MIME parsing,
  matching, classification, a suggestion queue, and an app password at rest in a database with no
  encryption story — and its value scales with a volume of applications you do not have. Stall
  detection catches forgotten applications from data already present, with no credentials and no
  classifier. Was held open pending "one real search and evidence"; closed 2026-08-21 without
  waiting for either, by direct decision. Not deferred — ruled out.
- **Tags on achievements.** Retrieval at review time is thematic, and search finds words where tags
  find themes — an entry about unblocking a struggling colleague may never contain the word
  "mentoring". That gap is real, and the price is still too high: a tag list needs create, rename,
  merge and delete screens, and people tag inconsistently even from a fixed list, which produces a
  dimension that looks authoritative and is not. FTS5 covers most of it, and the achievement log's
  actual risk was never retrieval — it was the log staying empty. Was on § Decide after real use;
  dropped 2026-08-21 by direct decision rather than waiting out the months of log it would have
  taken to answer.
- **Notifications of any kind.** See the principle above.
- **Salary benchmarking, inflation adjustment, live equity valuation.** External data, stale between
  releases, and each would make Hyperion an advisor.
- **Goal and OKR frameworks, 360 feedback, review cycles.** "Career companion" is an unbounded
  category and the pull toward becoming a worse Workday is strong. The achievement log is the line.
- **Sharing between Users.** Several people on one deployment is supported; showing each other
  anything is not. That line is what keeps a permissions model out of the app.
- **Job description → gap analysis, and cover letter drafting.** The two unbuilt items § 6 used to
  list beside résumé bullets. Dropped 2026-08-20, by direct decision — like browser capture below,
  not deferred pending a signal. Cover letters carried their own argument from the start: the most
  common demo in this space and the least useful outcome. Gap analysis was the more defensible of
  the two and still goes, which draws the line the AI layer now holds: Hyperion's AI reads the
  record you built and gives it back to you as prose you would have written anyway. Judging a
  posting against you is a different job — closer to advice than to record-keeping — and the
  record is what this app is for.
- **Browser capture.** (`CONTEXT.md` § Capture, which defined the posting it would have pulled in,
  was deleted 2026-08-20 — the word survives everywhere in this plan and in the code, but only in its
  other sense, the always-visible Achievement input. Two meanings for one word, one of them for a
  thing that does not exist, was the collision worth removing.) Was planned (§ Feature set used to number it 6: a bookmarklet or thin
  extension posting a job page's URL, title and visible text to Hyperion, an API-key-guarded
  endpoint, no per-site parsers). Dropped 2026-08-19, by direct decision — not deferred pending a
  signal the way § When a search starts is; just not being built. Applications get entered by hand.

## Architecture

Following Prometheus rather than Atlas, deliberately.

Atlas put its derived logic in Java, which meant the browser demo needed a JavaScript port of that
logic, and then a fixture-contract apparatus — a seed generator emitting recorded backend responses,
a frontend test asserting the port still matches — purely to stop two implementations of the same
rules from drifting apart. Prometheus avoids the problem instead of testing for it: one TypeScript
engine, no I/O, running in the browser in both builds.

Hyperion has more derived logic than either sibling — timeline assembly, compensation reconstruction,
tenure, switch-vs-stay, later vesting and pipeline statistics — which is exactly the surface that
would have to be duplicated under the Atlas model.

| | |
|---|---|
| `domain/` | the engine — timeline assembly, compensation math, tenure, later vesting and pipeline statistics. No framework imports and no I/O, so every rule is testable on its own. |
| `storage/` | the port, expressed in domain operations, and its two adapters: SQLite over HTTP, and `localStorage`. One contract suite runs against both. |
| `ui/` | Vue 3. Views and nothing that decides anything. |
| `server/` | static files plus row-level CRUD, holding no domain knowledge on purpose. |

**Identity lives at the boundary, never in the domain.** `domain/` does not know what a User is; it
receives rows and computes over them. Scoping happens in `storage/` and `server/`, which hand the
engine only the signed-in User's data. This keeps every domain test free of auth fixtures and keeps
the demo build working unchanged — the `localStorage` adapter simply always scopes to one implicit
User.

**Two builds from one codebase**, as in both siblings: the self-hosted app against SQLite, and a
static demo against browser storage with seeded data. The storage port carries both adapters from the
first commit; the seed content is authored at the end of the first build, once there is an app to
seed.

**The demo is a fictional persona in a foreign market** — a career in USD or EUR, a different
industry, a different city. This is not decoration. A believable Brazilian career with figures like
*R$ 180,000 → R$ 240,000* will be read as yours no matter what a banner says, and the more convincing
it is the more that assumption sticks. A foreign persona is unmistakably not you, stays just as
believable since the constraint was only ever internal coherence, and has the side benefit of
exercising the currency-labelling path in a currency your own instance never uses.

The demo opens on the login screen with credentials pre-filled and read-only, behind a button reading
**View the demo**, so the auth surface is visible without a visitor guessing at anything. It is a
facade — the demo has no server — and the banner says so rather than letting it read as a security
claim. Read-only applies to the login fields alone: inside, the demo is fully editable.

**Money** takes Prometheus's discipline but not its single-currency assumption. Even with conversion
deferred, four commitments hold from the first commit, and they are the conditions under which
deferring conversion is safe rather than merely postponed:

- **An amount is always a pair** — minor units and a currency code — in the schema, in domain types,
  in every signature. `Money = number` anywhere in `domain/` turns conversion into a rewrite of every
  function that touches compensation.
- **Precision is stored, not assumed.** Two decimals is a property of BRL, not of money.
- **Aggregations refuse to mix currencies** rather than coercing silently, even while they always
  agree.
- **Aggregation return types can express "mixed"**, so adding conversion never changes a signature or
  touches a call site.

**Time** follows Atlas: all date-dependent logic goes through an injected clock, so tenure, vesting
and the seed generator are deterministic under test.

**Stack**: TypeScript, Vue 3, Vite, Vitest, better-sqlite3, one Docker container, one SQLite file.

## Design — resolved

Settled before any code was written. Four standalone pages in `design/`, each openable on its own:

| | |
|---|---|
| `identity.html` | palette with jurisdictions, the three type roles, the Pillar, the day-one state |
| `accents.html` | the accent shortlist judged as logos, against the siblings |
| `compression.html` | how a career compresses without lying about it |
| `views.html` | the five views, each with its empty state |

### What it takes from the family, unchanged

Read out of the siblings' stylesheets rather than assumed — they landed on the same values
independently, so this was never an open axis:

| | Prometheus | Atlas |
|---|---|---|
| Scheme | dark only | dark only |
| Page | `#12141c` | `#12141A` |
| Surface | `#1a1d28` | `#1B1E27` |
| Hairline | `#262a38` | `#2A2E3A` |
| Text | `#f0f1f5` | `#EDEFF4` |
| Muted | `#8b92a5` | `#8C93A6` |

Plus Prometheus's discipline of **palettes with declared jurisdictions** — its category colours
carry comments saying nothing outside those charts may use them. A palette without a stated
jurisdiction becomes fruit salad.

### What it decided

**The accent is `--selene` `#9D7BE0`, and the accent is the logo.** The suite mark is one shared
shape recoloured per app — Prometheus `#e8935c` and Atlas `#4f8dff` are byte-identical apart from
the fill. That single fact decided the palette: it ruled out warm (Prometheus's), blue (Atlas's),
and anything pale, since a washed mark beside two saturated ones reads as a colour nobody chose.
Hyperion fathered the moon as well as the sun, so it takes moonlight with enough chroma to be a
mark. Named for the concept rather than the pigment, the way Prometheus names its accent `--fire`
and not `--orange`. `hyperion-logo.svg` sits at the repo root beside its siblings' equivalents.

Its jurisdiction is narrow: **the present tense only** — current position, today, the active view.
Never decoration, never a chart series. `--rise` and `--fall` carry deltas and outcomes and
nothing else. Three colours over the family's five neutrals, and no more.

**Type is IBM Plex Sans, Serif and Mono — one superfamily, three roles, bundled not fetched.**
Atlas imports from Google Fonts, which breaks the moment the box is offline. The signature move is
the serif: **achievements are set as document rather than interface**, because they are the one
place a person wrote something in their own voice to be read back years later, and neither sibling
has a serif anywhere.

**The signature is the Pillar.** A career is one continuous vertical rule. A position thickens it,
a gap thins it to a hairline, marks crossing it are events, and only `selene` reaches the live
stretch — so "where am I now" is answered before a word is read. Hyperion is the Pillar of the
East; the rule is the pillar, which is both the justification and the reason it is vertical.

**Compression is the fold, and the rule is not a ruler.** A career is mostly nothing happening, so
stretches holding events render to scale with a floor, and quiet stretches over the threshold
collapse into one row stating exactly what they hid — `2y 4m · nothing logged` — which opens on
click and nests. Nothing is ever capped or squashed silently: time is either shown to scale or
explicitly folded and labelled, the same rule already applied to Converted amounts. Exact duration
lives in text, where it can be read precisely. This removes both a zoom control and a minimap.

**Concurrent positions render as an inset, not a split rule.** Contract work alongside a salaried
job appears as a bordered block in the content column with its own short rail. Splitting the spine
was tried and reads as a rendering fault — and spending the Pillar's central claim, that a career
is one unbroken line, on an edge case is the wrong trade regardless of how it looks.

### Conventions these set

- **No dashboard.** Home is the Timeline. A screen summarising five things already visible is the
  personal-app feature that gets opened twice.
- **Capture repeats on two screens** — Timeline and Achievements — but no longer identically.
  Achievements keeps the plain inline `CaptureBox` (today, no Impact, one click). Timeline's is now
  the Log-achievement card, which opens `LogAchievementModal` (any date, any Position, optional
  Impact) — the sidebar spent the room a modal needs, Achievements never had it to spend. Capture
  itself is still the one thing allowed to repeat at all, because the cost of it being one click
  away is the whole log.
- **Suppression over partial figures.** Switch premium with one position renders as a sentence
  saying what it needs, never as `0%` or `—`. Atlas sets this precedent and it matters more here,
  where the figures are somebody's pay.
- **Empty states are invitations**, and they point at whatever *is* useful now. Every view was
  designed holding nothing as well as holding a career.

### Still open

- **Type is the safe choice.** Plex is coherent, licensed and bundleable, but it is not a risk. If
  the identity ever wants sharpening, this is where the room is.
- ~~**Login and first-run are undesigned**, deliberately — they are the last thing built.~~
  **Built** 2026-08-19 with auth (§ Shipped — auth, below): `LoginView`, `SetupView` (the setup
  token) and `RegisterView` (the invite code) all exist and are routed. They were designed at the
  keyboard rather than in `design/`, which is the honest record of how it went — none of the four
  standalone pages covers them, and no canvas was made.

## Build order

Design is resolved above; this is what follows it. Phases here are **ordering, not
milestones**: this is one continuous build, and the sequence exists to stop the enhancement layer
being written before the record works — not to mark releases.

**1. The career record.** `user`, `position`, `standing_terms`, `payment`, `achievement`. The capture
box, the timeline, compensation reconstruction, FTS search, the staleness signal. Running against a
hardcoded current User.

**2. The self-assessment draft.** One prompt, one view, gated on a key.

**3. The application record.** `application`, `application_event`, `document`, Landing, offered terms,
and the unused `prior_application_id`.

**4. Auth and the demo seed.** `invite`, `session`, the login flow, Argon2id, the setup token, the
demo persona (**all shipped**, below).

Ten tables:

`user` · `invite` · `session` · `position` · `standing_terms` · `payment` · `achievement` ·
`document` · `application` · `application_event`

### Shipped — auth (build order step 4)

2026-08-19, once the gate was as cleared as the user's actual data was ever going to make it
(single job, no open Applications, Achievements ongoing rather than a backfill). `hasAnyUser()`
closes first-run Setup for good the moment the first User exists; every route past `setup` /
`login` / `register` / `session` 401s without a valid, unexpired Session, resolved from a cookie
(`HttpOnly; SameSite=Lax`, no `Secure` — `compose.yaml`'s own framing has no TLS story, so a
`Secure` cookie would silently break the deployment shape this app actually supports). Passwords are
Argon2id via `@node-rs/argon2` (`server/auth.ts`), never leaving `users.password_hash` for the
client or the domain layer to see. `SqliteStore` carries the auth methods directly (`storage/sqlite-store.ts`)
rather than a second port interface — the demo/local-dev build has no *real* login at all
(`ui/store.ts`'s own split) and was never going to implement one; the demo's own login screen
(below) is a facade over the same `LocalStorageStore`, not a second auth system.

A real gap surfaced and closed in the same pass: `writePosition` / `writeAchievement` /
`writeApplication` / `writeDocument` used to take the client's object whole, `userId` included, with
nothing checking it matched whoever was actually signed in — harmless with one hardcoded User,
a real cross-tenant hole with real ones. Closed with a 403 on any mismatch. Client-side, every
hardcoded `'local'` / `CURRENT_USER_ID` write is gone, replaced by `ui/record.ts`'s `currentUserId()`
— the id `ui/main.ts`'s bootstrap actually resolved a Session to, not a constant.

New: `LoginView` / `SetupView` / `RegisterView` (no app shell — `App.vue` hides nav on these), and a
real `SettingsView` replacing the old stub — self password change always, an Admin section
(generate/revoke Invites, list Users, reset a password — each reset also invalidates that User's
Sessions) only when `record.user?.isAdmin`. Verified end to end against `npm run build:self-hosted`
and a scratch SQLite file: first-run setup, sign out and back in, an Invite that registers a second
User whose writes carry their own real id, Settings' Admin section invisible to that second User.

Found and fixed in passing: nothing ever actually set `VITE_STORAGE=server` at build time (no
`.env.server` existed), so `npm run build:app` had silently been shipping the browser-localStorage
adapter instead of talking to the server at all — predates this session's changes. `.env.server` now
sets it, which is what let the flow above be verified against the real server in the first place.

### Shipped — the demo persona

Same day. Per § Architecture's own spec: a fictional persona in a foreign currency (EUR), not the
real user's own — **John Doe**, Backend Engineer, three Positions over ~9 years (Fenwick Digital →
Nordwerk → Kestrel Systems, the current one, promoted partway through), a raise within each of the
two multi-Standing-Terms Positions, a signing bonus Payment, four Achievements with real engineering
substance, and one in-flight Application sitting at `interview`. `EmploymentType` reads `contract`
throughout — `clt`/`pj` are Brazil-specific (CONTEXT.md § Employment Type) and would read as an error
next to a European company. Authored once, in `ui/demo-seed.ts`'s `seedDemo()`, entirely through the
same `store.write*`/`createUser` calls any real use of the app already makes.

The login-screen facade is its own build-mode distinction from plain local development, which the
codebase didn't have before this: `ui/store.ts`'s new `isDemoMode()` reads Vite's own `import.meta.env.MODE`
(`'demo'` under `vite build --mode demo`, `'development'` under plain `npm run dev`) — no new env
var needed, unlike `isServerBuild()`. `DemoLoginView.vue` shows disabled, pre-filled fields and one
"View the demo" button behind a banner stating plainly that it's a facade; a `hyperion.demo-entered`
localStorage flag, set the moment that button is clicked, means a returning visitor's own edits are
never re-seeded over or hidden behind the facade twice. Plain local dev is untouched by any of this —
straight to the single empty seeded User it always was.

Verified against a real `npm run build:demo` + static serve: the facade on first load, the full
persona rendering correctly across Timeline/Positions/Compensation/Achievements/Applications after
"View the demo", no re-seed or duplication on reload, and `npm run dev` unaffected throughout.

### Shipped — the Assessment Stage and Round

2026-08-19, out of a conversation about a two-Stage proposal ("Interview Scheduled" / "Interviewed")
that turned out to misdiagnose the actual gap: Stages already aren't ordinal in the stored data —
Status is just the latest Event's Stage, nothing enforces forward motion — so a take-home test simply
had nowhere to go, not an ordering problem. `assessment` joins the `Stage` union between `screen` and
`interview` (CONTEXT.md § Stage); no migration, the column was always unconstrained `text`.

**Round** (CONTEXT.md § Round) is the bigger piece: one entity for every step a company actually put
an Application through — phone screens, technical rounds, take-homes, finals — deliberately not split
into separate Interview/Assessment types, since a live pair-programming round is a conversation and a
test at once and the two would behave identically regardless. `kind` is coarse on purpose (`interview`
| `take-home`) — which flavor of interview it was lives in the one free-text `notes` field, the same
shape Achievement's own `text` already uses. Unlike every other dated row in the app (Standing Terms,
Payment, Achievement, Application Event — all add-only, a correction is a new row), a Round is
genuinely edited in place: it starts as just a date and kind when scheduled, and the same row gains
its `notes` once it has actually happened, which is the entire reason CONTEXT.md separates Round from
Application Event in the first place.

Full stack: `domain/types.ts` (`Round`, `RoundId`, `RoundKind`), `storage/port.ts` (`writeRound`/
`deleteRound`, `UserRecord.rounds`), migration #4 in `storage/sqlite-store.ts` (a `rounds` table,
cascading off `applications`), the same two methods added to `LocalStorageStore` and `httpStore`,
shared CRUD coverage in `storage/port-contract.ts`, `PUT`/`DELETE /api/rounds/:id` in `server/server.ts`,
and the UI on `ApplicationView.vue` — an edit affordance alongside the usual delete, the one exception
to this app's otherwise-universal "add or delete, never edit" convention for dated rows. Verified
end-to-end in-browser: add, edit-in-place with no duplication, a second Round of a different kind on
the same Application, and delete.

### Shipped — home page redesign

Started 2026-08-19, from the complaint that the home Timeline "feels too empty" next to
`design/views.html`'s mockup. Explored via `/design` (a Claude Design canvas, separate from the
static pages in `design/`): two layout options, sidebar vs. a header strip. **Sidebar chosen** —
supporting cards in a column beside the Pillar, the same relationship `identity.html` already used
for Timeline + a secondary panel, rather than a header strip that pushes the Pillar down the page.

**Decided:**
- Sidebar, top to bottom: a small **Log an achievement** card (replaces the home page's inline
  capture row — opens a modal with Position / Date / the note itself / an optional Impact, fields
  Achievement already has and nothing on-screen has captured until now), then **Current Position**
  (role, tenure, total comp, Stay Premium), then **Applications** (latest 3 open, "N open", a link
  to the full list).
- The Achievements page keeps its own plain inline capture box as-is — only the home page's capture
  becomes the modal-opening card. (This starts to break "Capture repeats on two screens... identically"
  under Conventions above; revisit that line once the modal actually ships.)
- The Pillar itself: Positions only — Achievements no longer render there (**shipped**, below).

**Shipped this session** (domain + UI, typechecked, tested, verified in-browser):
- `domain/timeline.ts` — `TimelineEvent` drops the `achievement` kind; `timelineEvents` drops its
  `achievements` parameter.
- `ui/views/TimelineView.vue` — a changed Standing Terms is labelled **Raise** (pay moved, title
  didn't) or **Promotion** (title and pay both did, with the title change spelled out) instead of
  the generic "Standing Terms"; role/company/the NOW tick no longer repeat on every delta row —
  that becomes the Current Position card's job once it exists; the gutter shows a year once per
  held stretch and just the month after that, not a full date on every row.
- The sidebar itself: `TimelineView.vue` now renders the `.home-layout` grid (Pillar + `.side`)
  from the design canvas — Log-achievement card, Current Position card (reads `stayPremium()` from
  `domain/compensation.ts`, previously written but unused), Applications card (latest 3 open,
  "N open", "N total", links to `/applications`). Each card carries its own empty state, matching
  `DayOne.dc.html`. `ui/record.ts`'s `logAchievement()` now takes a Date and an Impact (`date:
  IsoDate = today()`, `impact: string | null = null`) instead of always today's date and `null`;
  `CaptureBox`'s own call site is untouched by the new defaults. `ui/components/LogAchievementModal.vue`
  is the new log-achievement dialog (Position / Date / text / optional Impact), matching
  `Modal.dc.html`; it lists every Position, not just the current one, so backfilling against a past
  Position still works. `CaptureBox` no longer renders on the Timeline — the Log-achievement card
  replaces it there; `AchievementsView` keeps its own plain inline `CaptureBox` as before.

Canvas: https://claude.ai/code/artifact/7801da2f-1739-4ec7-bc9c-49707938bf8e — `Main` is the chosen
direction, `Modal` the log-achievement dialog, `DayOne` the near-empty state, `OptionB` the
rejected header strip kept for reference. Working files under `design/canvas-home/`.

**2026-08-19, two small fixes once real Applications made both visible**: the nav link read
"Timeline," which stopped being accurate the moment the sidebar shipped — renamed to **Home** in
`App.vue`, and the route itself from `timeline` to `home` in `router.ts` (nothing else referenced it
by name). The Applications card's divider doubled up between the last row and "N total / View all":
`.app-row:last-child { border-bottom: none }` never actually matched, since `.app-foot` was a
sibling of the `v-for`'d rows and so was *itself* the true last child — wrapping the rows in their
own `.app-list` container let the selector find the real last row again. The Timeline pillar itself
(`domain/timeline.ts`, `TimelineEvent`, `foldTimeline`) keeps its name; only the page's own identity
changed.

### Monthly display, and Positions gets its own view

Also 2026-08-19, prompted directly by real data going in (§ The gate, below — this is that starting):
a CLT salary typed the way Brazil actually quotes it, monthly, kept landing wrong, because every
Standing Terms figure in `domain/compensation.ts` is stored and computed annual with nothing reading
it any other way.

**Shipped:**
- `User.compensationDisplay: 'annual' | 'monthly'` (`domain/types.ts`) — a per-User display
  preference, never how anything is stored. `compensation.ts` gained `perMonth()`, the one place
  the annual→monthly division happens. A Monthly/Annual toggle wired to `saveUser` now sits on the
  Current Position card, Position detail, and the Positions page below — flipping it anywhere flips
  every point-in-time salary figure app-wide. `AddPositionModal` and Position detail's "Add Standing
  Terms" form both gained a matching entry-time "per month / per year" selector, so what gets typed
  is what gets stored — converted once at the boundary, not assumed. `storage/sqlite-store.ts` took
  its second migration (`compensation_display`, default `'annual'`) for this.
- The Pillar's gutter label changed twice: first a fix so a Fold between two same-year events
  restates the year rather than compressing to a bare month that read as ambiguous; then, on direct
  feedback, the compaction was dropped outright — every dated row now reads "Mon YYYY".
- **Positions is now a first-class view** (`ui/views/PositionsView.vue`, routed at `/positions`, in
  the nav between Timeline and Achievements). Position is the primary entity and had no home of its
  own before this — only a detail page reachable by scrolling the Pillar or the Compensation page.
  Current/Past sections, the same shape `ApplicationsView` already uses for Open/Closed.
  `AddPositionModal.vue` replaces the old inline `AddPositionForm` — Position creation moved off the
  Timeline entirely, the same way Application creation only ever lived on `ApplicationsView`.
  Designed via `/design` first (two directions on one canvas — a card grid vs. a list of row-cards;
  the list was chosen). Working files under `design/canvas-positions/`.

### The gate

**Cleared** — confirmed 2026-08-20, the real career record is entered. It was not cleared in the
order this section intended: eleven features shipped past step 4 first, and the gate was raised again
each time rather than enforced.

**Your real data goes in before anything past step 4 gets written.** Not "used for a month" —
entered. Your positions, your compensation history, your current job. That is an afternoon of typing,
and it is what makes "personal tool first" real rather than aspirational. It will also surface more
design problems than another week of planning, because your actual history will not fit the model as
cleanly as the model expects.

### After the gate

Equity, and nothing else — as of 2026-08-20, with currency conversion shipped below, it is the last
unbuilt item in this plan. The AI layer also sat in this list; it is finished, résumé bullets
shipped and the other two dropped (§ 6, § Deliberately not building). So did data export, shipped
below (§ Architecture: "exporting your data from Settings is the other half" of the backup story).

### Shipped — data export

2026-08-19. `ui/zip.ts` is a small, dependency-free ZIP writer — stored (uncompressed) entries
only, no DEFLATE — since the payload is career-record JSON plus a handful of résumé-sized files,
not worth implementing DEFLATE for (`readZip`, added alongside data import below, reads DEFLATE
entries too, via the platform's own Compression Streams API — still no dependency added).
`ui/export.ts`'s `buildExport()`
assembles `data.json` (every row the signed-in User has, Documents' metadata included) plus each
Document's actual bytes under `documents/`, reading only through `record.ts`'s own state and
`readDocumentBytes` — so it runs identically over every storage adapter, no new server route or
port method needed. `ui/views/SettingsView.vue` gained a "Your data" panel, above the
server-build-only sections so every build (self-hosted, demo, plain local dev) gets a way out —
the browser-storage builds have no `cp hyperion.db` equivalent at all, so the need is if anything
sharper there. Verified in-browser: the zip's local file headers, CRC-32s and end-of-central-directory
record all check out, and `data.json` round-trips the real record correctly.

### Shipped — data import

2026-08-19, prompted directly by the observation that an export nobody can read back in is not
actually a backup. `ui/zip.ts` gained `readZip()`, decoding both stored and DEFLATE-compressed
entries (the platform's `DecompressionStream`, no dependency) — an export re-saved by an ordinary
zip tool along the way is likely DEFLATE, not stored, so reading only what `buildZip` itself writes
would have made the round trip fragile the moment a person actually touched the file.

`ui/import.ts`'s `applyImport()` writes everything back through `record.ts`'s own save* actions —
never a new port method — so a restore can't write anything the app itself wouldn't accept from the
UI. Additive by design: every row writes by id, so importing onto existing data merges rather than
replaces it, and nothing is ever deleted; re-running the same import twice is a no-op. The one real
correctness point: every row's `userId` is rewritten to the *signed-in* User's own id rather than
trusted from the archive, since an export is usually imported into a different account than the one
that made it (a fresh self-hosted install, a new browser) — writing Position/Achievement/
Application/Document rows with someone else's userId is refused outright by the server's own
write-ownership check. `record.ts` gained two primitives `logAchievement`/`uploadDocument` didn't
expose — `saveAchievement()` and `restoreDocument()` — since both of those always mint a fresh id,
and a restore needs to write a row's *original* id back.

Settings gained an "Import your data" file picker beside Export, with a confirm prompt stating
plainly that matching ids get overwritten and nothing is deleted. Verified in-browser with a full
round trip: exported the real record, re-imported the same zip, and confirmed every count matched
with no duplication anywhere (Positions, Applications and their Events all stayed at their original
counts after the "restore").

### Shipped — Prior Application

2026-08-19, once the first real Applications existed to have history with. `domain/applications.ts`'s
`priorApplicationFor(candidate, existing)` matches by posting URL, or by company with a similar title
(CONTEXT.md § Prior Application) — a union of both signals, since neither alone is reliable: the same
posting gets re-listed under a slightly different title, and two different roles at one company can
otherwise share a title outright. Of several matches, the one `existing` places last is used — the
same later-in-the-list-is-later-in-time convention `eventsNewestFirst` already uses. Set once, at
creation, into the `priorApplicationId` column that had sat unused since § The application record.

`ApplicationsView.vue`'s Add-Application form shows the match as it's typed — plain context normally
("You applied to X before, ended REJECTED"), a red warning only when that match is still Open (the one
case worth raising a voice for). `ApplicationView.vue`'s detail page carries the same note permanently
once an Application has a `priorApplicationId`, linking back to it. "Apply again," on a Rejected or
Withdrawn Application's own detail page, is CONTEXT.md's "pre-fills the new Application from the old
one if you go again" — a `/applications?again=<id>` link that pre-fills company, title and source and
opens the form.

Verified in-browser against a real prior Application, and caught a real, pre-existing bug doing it:
`ApplicationView.vue`'s `currentStatus` called `status()` on `events`, a computed already run through
`eventsNewestFirst` for display — `status()` sorts internally too, and applying the same-day tie-break
a second time reads position in the already-reordered array as if it were original insertion order,
inverting it. Invisible until an Application first had two same-day Events, which this session's own
manual testing happened to produce. Fixed by reading `events.value[0]?.stage` directly instead of
re-sorting; `status()` gained a doc comment warning against ever passing it pre-sorted input again.

### Shipped — Stall detection and the attention view

2026-08-19. `domain/applications.ts`'s `isStalled(events, today, stallThresholdDays)` (CONTEXT.md §
Stalled): false for anything already Terminal — nothing left to have gone quiet — otherwise true once
the most recent Event is older than the threshold. The one item in this list that really was waiting
on something: not the mechanism, which needed no real data to build, but the threshold's own default
(21 days, set at account creation and never surfaced since) — only worth trusting once tuned against
applications actually going quiet, so Settings gained a plain number input for it
(`User.stallThresholdDays`, via the existing `saveUser`).

The attention view turned out not to want a new route: "there is no separate dashboard" already ruled
that out (`ui/router.ts`'s own comment), and `ApplicationsView.vue` already had a natural home for it.
A **Needs attention** section, drawn from the Open set and shown above Open itself, lists whichever of
those are currently Stalled — the same rows still appear in Open too, since attention is a callout, not
a replacement for the ordinary list. Reported neutrally throughout, per CONTEXT.md: a "quiet 25d" chip,
not a warning color or an alarm.

### Shipped — the funnel, response rates and time-to-response

2026-08-19, by direct request rather than waiting on real search volume — this is the one item in
"When a search starts" that carried no prior CONTEXT.md entries, so the definitions below are new,
settled while implementing rather than agreed first. CONTEXT.md gained **Response**, **Response
Rate** / **Time to Response** and **Funnel** to record them.

The one real judgment call: what counts as a **Response**. Not every Event past Applied — Withdrawn
is the applicant's own action and proves nothing about the other side, so an Application that goes
straight from Applied to Withdrawn, nothing between, counts as never having gotten one. Everything
else past Applied does, Rejected included: a closed loop is a Response, distinct from silence nobody
ever broke. An Application Interviewed and then Withdrawn still counts — the Response came first.
`domain/applications.ts`'s `hasResponse()`/`daysToResponse()` carry this.

The Funnel counts, per Stage, how many Applications *ever* reached it — not "currently at or past,"
since Stage isn't ordinal (§ Stage): an Application that skipped Screen entirely, Applied straight to
Interview, correctly never counts toward Screen. Rejected and Withdrawn are exits, not funnel points.
`funnelCounts()` returns fixed order: Applied, Screen, Assessment, Interview, Offer, Landed.

No new route — a **Pipeline** section joined the top of `ApplicationsView.vue`, above Needs
attention: funnel counts, and a responded/total line alongside average time to Response.
**Revised the same day**: `responseRateBySource()` originally broke that line down by Source, per
Source's own CONTEXT.md note that it was "the dimension response rates are most worth broken down
by" — dropped on direct feedback, since splitting an already-small number into smaller per-Source
buckets multiplies the low-volume noise problem rather than managing it. `responseRate()` replaced
it, one overall figure; both CONTEXT.md entries updated to match. Numbers are reported plainly
throughout — no percentages under low volume, no color coding.

### Shipped — editing an Application's Company, Title, Source and Posting URL

2026-08-19. A real gap, not a planned item: Advertised Range, Offered Terms and the attached
Document all had an edit path from early on; Company, Title, Source and Posting URL — set once in
the Add-Application form — never did. `ApplicationView.vue`'s header gained the same "edit" affordance
the other sections already use, opening an inline form pre-filled from the current values. No domain
or storage change — `saveApplication` already accepted a full row, this just gave the UI a way to
send one back with those four fields changed.

### Shipped — Achievements → résumé bullets

2026-08-19, the first piece of § 6, built by request ahead of the other two. Follows the
self-assessment draft's own mechanism exactly, since that pattern already existed and worked:
a pure domain prompt-builder, `ui/ai.ts` sending it with the User's own key straight from the
browser, the result rendered as a Suggestion (CONTEXT.md § Suggestion) — never saved, never acted
on. `ui/ai.ts`'s `generateSelfAssessment` was generalized to `askClaude(apiKey, prompt, send)`,
prompt-agnostic, since a second AI feature made three near-identical senders worse than one shared
one; `domain/resume-bullets.ts`'s `buildResumeBulletsPrompt()` reuses the self-assessment draft's
own `SelfAssessmentEntry` shape and Date/Position scoping unchanged, asking for short, action-verb
lines instead of prose, quantified only where an Achievement's own Impact states a number.

`ui/views/ResumeBulletsView.vue` mirrors `SelfAssessmentView.vue` closely, including its own
self-contained API-key panel — duplicated rather than extracted to Settings, since that would have
been a refactor of a separate, already-shipped, working feature beyond what was actually asked for
here. Reached the same way the self-assessment draft is, from a second link on
`AchievementsView.vue`, not from the top nav — matching "no separate dashboard," the same reasoning
that kept the funnel and stall detection off a route of their own. Output renders as a plain list,
each line the model returned, stripped of any stray numbering or bullet marker it added anyway.
Verified end-to-end with a mocked Anthropic response: the built prompt, the entry scoping, and the
list-splitting all check out against real Achievement data.

### Shipped — AI Setup goes multi-provider

2026-08-19, same day, on a direct request: "could we use a library... so they can use different
providers/models." Two paths were checked and both turned out wrong for Hyperion specifically —
worth recording why, since both looked reasonable at first.

The Vercel AI SDK (`ai` + `@ai-sdk/*`) was installed, then reverted. It is a real, well-maintained,
widely-used multi-provider abstraction, and its Anthropic provider does support direct-from-browser
calls (`createAnthropic({ apiKey, headers })`, confirmed against current docs) — but Hyperion's own
use is one-shot prompt-in, text-out, none of the streaming/chat/tool-use surface the SDK earns its
keep on, and package.json had carried exactly four runtime dependencies until this session's own
hand-rolled ZIP writer reinforced that restraint on the very same day. Fourteen packages for a
capability comparable in size to `ui/ai.ts`'s existing ~30-line sender was the wrong trade for this
project, even though the library itself is a fine choice in general.

The fix that actually fit: **every provider gets targeted through the OpenAI-compatible
chat-completions wire shape** most of them now expose (`AiPreset`, `ui/ai.ts`), so one function —
still a plain `fetch`, no dependency — reaches Anthropic, Google Gemini, and anything else speaking
the same shape, varying only base URL, key and model (CONTEXT.md § AI Setup). This nearly went
wrong too: OpenAI itself turns out to send no CORS headers at all, so **no browser can call OpenAI
directly regardless of request shape** — confirmed by research before committing to the design, not
after. OpenAI is deliberately not one of the presets; a User pointing a custom base URL at it would
just hit a clear, surfaced error, the same as any other unreachable endpoint.

`domain/types.ts`'s `User.aiApiKey` (one field) became `aiBaseUrl` / `aiApiKey` / `aiModel` (three,
all-or-nothing — CONTEXT.md § AI Setup), migration #5 on `storage/sqlite-store.ts`. Existing Users
land back in the gated "needs setup" state, since a key alone no longer says where to send it or
which model to ask for. `ui/ai.ts`'s `askClaude` became `askAi(baseUrl, apiKey, model, prompt,
send)`; `AI_PRESETS` holds Anthropic and Google Gemini plus a Custom option that leaves the base URL
free-text, reaching anything else that speaks this shape (a local model server, a provider not
listed). Only Anthropic's model id is pre-filled (`claude-sonnet-5`, confirmed current) — Google's
changes too often to guess at confidently, so its field is left for the User to fill in themselves
rather than risk a stale default. Switching providers resets the model field rather than leaving a
stale one behind, since a model id from one provider means nothing to another.

Both `SelfAssessmentView.vue` and `ResumeBulletsView.vue` gained the same three-field setup panel in
place of the old single key field, still duplicated between the two rather than extracted — the same
call made when résumé bullets shipped, unchanged by this. Verified end-to-end in-browser: switching
the provider preset correctly swaps the base URL and clears the model, saving persists all three
fields, and a mocked response confirms the exact request (URL, headers, model, message) reaching a
non-Anthropic endpoint.

**Revised within the hour, on direct feedback, two fixes at once**: Custom only cleared the model
field, not the base URL — `if (preset.baseUrl) baseUrlInput.value = preset.baseUrl` skipped the
assignment for Custom's own empty string, so whichever preset's URL was there before it just sat,
unlabeled as such. Unconditional assignment fixed it. Second, the duplication call above was
reversed on request: the setup panel moved to `SettingsView.vue` as one shared "AI Setup" section,
and both AI views collapsed to a plain `isSetUp` check with a link to Settings when it's not — the
"a third AI view is what would justify this" threshold guessed at above never actually needed to be
reached; being asked directly was enough.

### Shipped — currency conversion

2026-08-20, and much smaller than § 8 reads, because the goal narrowed it: "land a job that pays me
in USD while still living in Brazil, then see how big of a jump that was." That is one figure, not a
converted view of the app, and everything that would have served a converted view got cut before it
was built — no display currency, no per-view "show in" selector, no converted totals anywhere.
Two of those were designed and recommended in the same session before the goal made them unnecessary.

**The case § 8 warns about does not apply here, which is worth recording since the warning is right
in general.** Converting a São Paulo salary to dollars says little about whether you are better off
*because cost of living dominates* — but that assumes you moved. Earning USD while living and
spending in BRL holds cost of living constant, and the rate is then the whole story. This is the one
shape of cross-currency comparison Hyperion can answer honestly.

That also settled the target currency with no setting: **convert into the earlier figure's
currency**, never the later one. "How big a jump was that" is asked in the units of what you were
making before, and in the case above those are also the units you spend in. The target falls out of
the comparison, so there is no display currency, nothing on `User`, and `CONTEXT.md` § Currency's
_Avoid_ list keeps "base currency" on it.

`domain/rates.ts` holds the whole mechanism: `Rate` carries its own `decimals` for the reason
`Currency` does — quoted rates run to four or five places where salaries are held to two, and
flattening one to the other costs about R$400 on a six-figure figure. Arithmetic is `BigInt`
throughout, so an intermediate product never silently loses precision and the only exactness check is
on the result, which has to be a real amount. A rate answers **both directions** — recording
"1 USD = 5.4231 BRL" is the same fact as its reciprocal, and asking twice would be asking twice for
one answer — with `FoundRate.inverted` saying which way it was stored so a figure names the rate the
User actually typed. `findRate` takes the **nearest** date rather than on-or-before: a rate is
remembered to be reused, and what keeps it honest is not narrowing the match but showing which rate
was used and when, which every caller does (CONTEXT.md § Converted).

`Premium` gained a third case. A cross-currency comparison is not `unavailable` — it is *answerable,
pending one rate* — so `needs-rate` carries the pair and the date, and `RatePrompt.vue` renders
exactly there. That is § 8's "asks for the rate it needs, at the moment it first needs it" as a
control rather than a sentence. `switchPremiums()` returns the pairs rather than only their average
for the same reason: a switch waiting on a rate needs somewhere to be asked about, which an
averaged-away number does not have.

**The offer-time half turned out to be missing entirely, and it is the more useful half.**
`domain/types.ts` § OfferedTerms and § Deliberately not building both rest on the claim that
"offered terms beside current terms is the whole of it" — but `ApplicationView.vue` never loaded
Standing Terms at all, so it had been rendering the offer alone. `offerPremium()` and a block on that
view fix it: a USD offer read against what you are paid now, converted, **while you are still
negotiating**. Landing gives you the same number after you have accepted, when it can only be read.

Two things fixed in passing. `CompensationView.vue` formatted every year of the total-comp chart with
`positions[0].currency` — the *earliest* Position's — so a BRL→USD career rendered its USD years with
`R$`; each year now carries its own. And the bars are scaled against the largest year **in their own
currency**, with a labelled break where the currency changes, because bar length is itself a
comparison and R$300,000 beside $120,000 is not two-and-a-half times anything. That list is a record
rather than a comparison, so it is left native and unconverted — the rate is asked for where a
comparison needs one, and nowhere else.

Verified in-browser end to end on a seeded BRL→USD career: the switch reads "needs a rate", the
prompt takes 5.4231, and R$260,000 → $140,000 resolves to +192.0% with "Converted — R$759,234.00 at
1 USD = 5.4231 BRL, 2025-03-01" beneath it; the same rate then serves the offer block on an
Application without being asked for again.

**The demo crosses a currency**, added the same day once the feature existed: John Doe's first
Position (Fenwick Digital, 2016–2018) pays in USD and everything after it in EUR, his Departure
reason reading "resigned — relocating to Europe" so the timeline explains its own currency change.
Without a crossing the whole of § 8 was invisible in the published build, and it is the least
ordinary thing the app does. One crossing out of two job changes is what puts every state on screen
together: the average Switch Premium still computes (+22.4%, from the EUR→EUR change) and says one
switch is missing from it, while the USD→EUR change below carries the prompt. Fenwick's base moved
€38,000 → $45,000 in the same edit, so that the switch resolves to a plausible positive figure at any
sane 2018 rate rather than to a drop. **No Recorded Rate is seeded** — Hyperion invents none for a
fictional person either, and a visitor typing one in and watching +34.0% appear demonstrates the
design better than arriving at a finished number. `.claude/launch.json` gained a `hyperion-demo`
entry (`--mode demo`, port 5174) so the demo build can actually be looked at, which is how the above
was verified.

The year-by-year display as a proper chart was left as its own piece of work — **shipped below**.

### Shipped — the compensation chart, and the end of the yearly bars

2026-08-20, immediately after currency conversion, and it changed what the view measures rather than
only how it draws it. On a direct steer: *"it doesn't actually have to be year by year… only show
data points where the comp increased, so if I went the entire 2025 without any comp change, it
shouldn't show on the chart."* Exactly right, and the reason is that a calendar year was never a
data point here — Standing Terms are carried forward unchanged until superseded (CONTEXT.md
§ Standing Terms), so a year in which nothing happened is the same figure restated. The old bars
spent most of their width redrawing what a reader already knew while hiding the month a raise
actually landed. `compensationLines()` replaces `totalCompensationForYear` on this view with the
dates that carry information: every Standing Terms where pay moved, and nothing else.

**Changed, not increased** — the one place the instruction was not followed literally, and it was
raised before building rather than after. A relocation that pays less in the new currency, or a
PJ→CLT conversion that moves the gross figure down, is a real point in a record; a line that plotted
only the rises would be untrue by omission, which is what every other suppression in this codebase
exists to avoid. Falls are drawn, and drawn as falls (`cut`, in `--fall`).

Four decisions the shape rests on:

- **A Standing Terms that moved the title and not the pay is dropped.** It belongs to the Timeline,
  which labels it, and not to a chart of what a job paid. A step is measured against the last point
  that *moved*, not against the row immediately before it.
- **Each Position is its own run.** The stretch between two jobs is an absence of compensation, not a
  compensation of zero, and a line dipping to the axis and back would assert a figure nobody
  recorded. This also handles overlapping Positions — contract work beside a salaried job
  (CONTEXT.md § Current Position) — as two runs rather than a sum.
- **One panel per currency, sharing the time axis.** Same reasoning that governs the Recorded Rate:
  two currencies have no common height, and the rate that would give them one belongs to the
  comparisons below, not to a record of what each job paid.
- **Payments are ticks on the baseline, off the y-scale.** A bonus that arrived once is not a rate
  the job pays; giving a €3,000 signing bonus a height beside a €71,000 salary would invite a
  comparison that means nothing (CONTEXT.md § Payment: treating the two alike is how a compensation
  history stops adding up). They stay visible, and stay off the line.

Verified against the demo career, where eleven bars became five points: `$45,000` at Fenwick, then
`€52,000 → €58,000` at Nordwerk and `€71,000 → €88,000 → €100,500` at Kestrel, each panel on its own
scale under a shared 2016–2026 axis. Screenshots were unavailable in the session, so the geometry was
checked numerically through the live DOM instead — three real bugs came out of that which a glance
would likely have missed: the first year's tick landing outside the frame at x = −29, the leftmost
amount label half off the canvas, and the panel labels sitting above y = 0. All three traced to one
cause, a time domain starting at the exact first date rather than at a whole year.

### Fixed — a second job read as a job change

2026-08-20. Found by asking what happens to a career holding two Positions at once in
different currencies (CONTEXT.md § Current Position: contract work beside a salaried job is
ordinary). The chart handled it correctly — two runs, two panels, nothing summed, which is
what "each Position is its own run" was for. What did not was **Switch Premium**:
`averageSwitchPremiumPercent` had paired Positions by start date since it was written, so a
second job taken *alongside* the first reported as a job change, and — after currency
conversion shipped — went on to ask for an exchange rate to quantify a move nobody made.
Pre-existing and long invisible; the average had been quietly including these phantom
switches, and only listing the pairs individually brought it into view.

The rule now matches the vocabulary: a switch is into a Position from the job most recently
**left** — a Departure on or before the new Position started — so a Position nobody had left
yet is not something you switched away from, and at most one switch lands per Position. A
gap between jobs still counts, since one was still left for the other.

### Shipped — Display Currency, and the chart as one shape

2026-08-20. The chart's redesign and the currency question turned out to be one decision, not two,
and it took a long conversation to see why: *"what I want this view to do is tell me the evolution of
my comp."* A view whose job is evolution cannot break in half at the moment the currency changes —
which, for the record this app is being built around, will be the largest step in the career.

What broke the deadlock was separating two things that had been stuck together. The objection to
converting was never conversion as such; it was **restating a salary as a number nobody was paid**.
So the chart converts the *geometry* and not the record: every point still reads in the currency it
was paid in — `$45,000` stays `$45,000` — and the rate supplies only the heights, which were never a
fact about anyone's pay to begin with. A marker names the crossing, a line beneath names the rate.
§ Converted's rule holds where it bites, and the line is continuous.

**One rate per currency, never one per point.** A rate looked up at each point's own date would let
the slope move because the currency moved, and a salary that never changed would draw as a rise or a
fall — the chart would stop being a record of pay. One factor rescales a currency's figures as a
block, so the shape inside it is exactly what happened. It is anchored at the first date both
currencies are on the record, which is also the date the Switch Premium across that boundary asks
about, so the two never ask for the same rate under two different dates. Entering it once resolves
both, verified in the browser.

**`User.displayCurrency`** (migration 7, three nullable columns flattened as Position flattens its
own) settles what the geometry resolves *to*, and — by direct decision — retargets Switch Premium
too, so a page cannot show one currency in a chart and another in the comparison beneath it.
`Premium.converted` became `conversions: FoundRate[]`, since converting both sides can want two
rates; one rate serving both sides is named once rather than twice.

Two calls worth recording:

- **Derived, not asked at sign-up.** Floated as a sign-up question and argued down: registration is
  the one moment there is no record to answer against, and it would be the upfront table § 8
  explicitly refused. `null` means *the earliest Position's currency*, which for a single-currency
  record is simply the currency — so nobody is asked, nothing prompts, and every existing record
  keeps behaving exactly as it did. The Settings control appears only once a record holds more than
  one currency.
- **It is not a base currency**, which `CONTEXT.md` § Currency lists under _Avoid_. The distinction
  is real and now written down (§ Display Currency): per-User rather than per-deployment, and it
  moves no stored amount. An earlier session argued against this setting on exactly that objection;
  what changed is that concurrency killed the alternative — with two currencies live at once there is
  no crossing to infer a direction from, and inference had run out.

Where a rate is missing the view falls back to a lane per currency — honest, just not yet one shape —
and asks for the one rate that would join them.

### Shipped — the staleness signal moves to Home, and the attention section goes

2026-08-24. The Needs-attention section shipped a callout on the page you only open *because* you
were already thinking about applications — which is the one audience that does not need telling.
CONTEXT.md § Stalled had already written the rule the section was failing: "being visible when you
open the app is the whole mechanism." Home is the page you open. So the signal moved there.

**On Home**, the Applications card sorts Stalled to the top and its foot gains a count — "2 total ·
1 quiet". The count, not the rows, is what carries it: the card shows three, and a signal that can be
pushed off the bottom by a fourth quiet Application is not a signal. Home points, `/applications`
lists.

**On `/applications`**, the Needs-attention section is gone entirely. It listed rows that were
already in Open directly beneath it, which is where the duplication had been defended as "attention is
a callout, not a replacement" — true, and still not worth showing the same Application twice. Open
itself now sorts Stalled first, then by recency as before, and a Stalled row carries the `quiet 66d`
chip in place of its ordinary `19d ago`.

**The chip took a colour**, which reopens the neutrality call made when stall detection first shipped
(no warning colour, no alarm iconography). New token `--quiet: #c0a878`, an amber held at `--fall`'s
own saturation — warm enough to find in a list, and nowhere near a warning. The dedicated section was
the louder of the two designs; losing it is what bought the chip the room to be tinted at all.

Rejected on the way: a fourth sidebar card (breaks "every card carries its own empty state", and a
card that appears and vanishes makes the sidebar jump), and rendering silence as gaps in the Pillar —
the Pillar is Positions only, and a signal measured in days does not belong in a structure measured in
years.

### Fixed — `PUT /api/user` took the caller's word for who they were

2026-08-24, found while reconciling these docs against the code. The route wrote whatever User
object the body carried: `store.writeUser(await asked(request, 'user'))`, with no check that its
`id` was the Session's. `writeUser` keys its update on `user.id` and writes `is_admin` straight
from the object, so a signed-in non-Admin could send their own User back with `isAdmin: true` and
have it — invites, the full Users list, and resetting anybody's password — or name somebody else's
id and overwrite their row instead.

Only the settings come from the body now; the id comes from the Session and `isAdmin` from what is
already stored. **No route grants the Admin bit** — the first User gets it at setup and nothing
changes it afterwards, which is a rule the code now actually keeps rather than one it happened not
to be asked to break.

This was reachable only in the self-hosted build, and only by somebody already holding an account.
That is exactly the boundary invite-only exists to draw (§ Users and access: "invite-only means that
deployment fails safe"), so it undid the guarantee between people sharing one deployment, not the
one against the open internet. Three tests in `server/server.test.ts` cover it — an ordinary
settings save still lands, the bit is refused, and a body naming another id writes the sender's own
row — and all three were confirmed to fail against the old handler before the fix went in.

### When a search starts

Rounds, prior-application awareness, stall detection, the funnel and response rates are all shipped,
above — everything originally listed here is now built.

### Decide after real use

Explicitly on no schedule, so a fast-moving build cannot quietly absorb them. Tags on achievements
and email status detection were both on this list and are now decided — against, both of them
(§ Deliberately not building). What remains:

- **Whether the staleness signal works**, or whether the log stays empty anyway.

## Portfolio framing

The honest arc beats the feature list. It starts as a tracker for an immediate problem, then runs
into the thing every tracker runs into — you land a job and never open it again — and the fix is not
better retention mechanics but a wider question: the app should hold the whole working life, not one
search.

"Job application tracker" is among the most common portfolio projects in existence. A longitudinal
career record with a coherent domain model is not, and it gives an interviewer something to ask about
beyond CRUD.

The suite context helps too: three apps sharing a self-hosting philosophy, a demo-build pattern and a
vocabulary discipline is a stronger signal than three unrelated projects, and the Atlas → Prometheus
→ Hyperion architectural progression is itself worth being asked about.

## Open questions

- ~~Whether a recorded rate is stored per pair-and-date and reused everywhere, or captured per
  comparison.~~ **Settled** 2026-08-20, and it turned out to have been settled all along:
  `CONTEXT.md` § Recorded Rate already said "for one currency pair on one date… remembers the
  answer", which is the reusable option. Taking the vocabulary as the authority rather than
  reopening the question was the whole of the decision.
- ~~Whether the single Admin bit is enough, and whether an Admin should see that other Users exist
  anywhere beyond the invite screen.~~ **Answered by the code**, and more permissively than the
  question imagined: Settings shows an Admin a full **Users** panel — every User by display name,
  which of them are Admins, and a reset-password control per row — alongside the Invites panel. It
  had to, since resetting somebody's password means naming them. The single bit has not run out: no
  feature since has wanted a second permission. What remains genuinely open is narrower — whether a
  second Admin can ever be made, since `isAdmin` is set at creation (true for the first User, false
  for every invited one) and nothing anywhere flips it.
- How résumé generation eventually renders — structured data to Markdown is easy, structured data to a
  good-looking PDF is not.

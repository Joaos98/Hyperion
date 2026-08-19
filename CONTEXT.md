# Hyperion

A self-hosted career record built on the **timeline model**: everything Hyperion holds is a dated
event on one axis. A **Position** is a job held, an **Application** is a job pursued, and **Landing**
an Application turns it into a Position — so job history is what the application tracker produces
over time rather than a feature beside it. Hyperion holds only what you put into it: no scraping, no
benchmarks, no price feeds, no inflation series, no exchange rate feeds. It is a record, not an
advisor, and it never interrupts — it shows state when you open it and pushes nothing. Several people
may share one deployment, each seeing only their own records.

## Language

**User**:
A person with a login and the private set of records behind it. Every domain row belongs to exactly
one User and is visible to nobody else — Hyperion is several private records sharing a deployment,
not a shared workspace. Prometheus avoids this word because its people are Members of one shared
Household with no isolation between them; here isolation is the entire point, which is what the word
describes.
_Avoid_: account, member, profile, tenant

**Admin**:
A User who can invite others and reset their passwords. One bit on a User rather than a separate kind
of thing, and the only permission Hyperion has. The first User created is an Admin.
_Avoid_: owner, superuser, root, user-admin

**Invite**:
A single-use code an Admin generates so somebody else can create a User. There is no open
registration: an account exists because a person deliberately made one possible. What this protects
is not your own network — where anyone who can reach Hyperion could already reach a sibling app that
has no login at all — but the deployments other people will stand up from the same code, some of
which will face the internet.
_Avoid_: invitation link, signup code, registration

**Timeline**:
The single dated axis every record sits on, and the app's central view — one continuous vertical
rule that thickens where a Position is held and thins to a hairline where none is. Positions only:
Standing Terms changes, Payments and Departures render as marks along it. An Achievement is a
personal record rather than a change to a Position, so it lives on the Achievements log and not
here — putting the same entry on two screens taught nothing a reader didn't already know. It is not
a separate store: the timeline is assembled from the same rows every other view reads. Nor is it a
ruler — its length is compressed by Folds, while exact duration is always stated in text. A changed
Standing Terms is labelled by what happened — **Raise** when only pay moved, **Promotion** when
title and pay both did — never repeating the role and company a reader already has from the Current
Position card.
_Avoid_: history, feed, activity log

**Fold**:
A stretch of Timeline holding no events, collapsed into a single row naming exactly what it covers —
a duration, and whether a Position was held through it. Opens on click, and nests: opening one
reveals its events and leaves the quiet stretches inside it folded in turn. A Fold never breaks the
rule, which stays thick through a folded stretch of employment and hairline through a folded gap.
Nothing is ever compressed without saying so, the same rule that governs Converted amounts.
_Avoid_: collapse, hide, summarise, zoom

**Fold Threshold**:
How long a stretch must go without events before it Folds. A per-User setting, because somebody
logging weekly and somebody logging twice a year want thresholds an order of magnitude apart.
_Avoid_: density, zoom level, granularity

**Position**:
A job held — one continuous stint at one employer, from a start date until its Departure or until
now. Titles change *within* a Position rather than starting a new one, so a promotion at the same
company extends the stint instead of splitting it; what a résumé renders as two nested roles is one
Position with a title change recorded against it. The same is true of a change in Employment Type.
_Avoid_: job, role, employment

**Application**:
A job pursued but not held — a prospective Position. It carries the company, the title, where it was
found, the posting link, the Advertised Range and, if one arrives, the Offered Terms. Its whole
pipeline history lives in its Application Events. Applications are not grouped into campaigns:
openings arrive continuously, and a date range answers everything a named grouping would.
_Avoid_: opportunity, lead, opening, job

**Landing**:
The action that turns an Application into a Position, carrying the company, the title and the Offered
Terms across as the new Position's Starting Terms. The Application is not consumed: it keeps its
event log and reaches the Landed Stage, because a record that produced an offer should still say so
afterwards.
_Avoid_: accepting, converting, hiring, closing

### Positions

**Position Event**:
Anything dated recorded against a Position — Standing Terms being set, or a Payment arriving. An
umbrella term rather than a store: the two kinds have different shapes and different arithmetic, and
they live in separate tables. Shorthand **Event** where the Position is not in doubt. Every
compensation figure in Hyperion is computed from these; there is no salary field living on the
Position itself.
_Avoid_: change, milestone, salary change, update

**Standing Terms**:
What a Position pays as of a given date — base salary, Target Bonus, title and Employment Type — set
by an event and carried forward unchanged until a later event supersedes it. Starting Terms, a raise,
a Promotion, a title change, a market adjustment and a change of Employment Type all set them. Terms
are a state and not a sum: two raises do not add together, the second replaces the first.
_Avoid_: current salary, package, compensation

**Payment**:
Money that actually arrived on a date and changed nothing going forward — a bonus paid, an equity
Tranche vesting. Payments accumulate across a period where Standing Terms do not, and treating the
two alike is how a compensation history quietly stops adding up.
_Avoid_: transaction, income, payout

**Starting Terms**:
The first Standing Terms a Position has — minted by Landing when the Position came from an
Application, and entered by hand when it did not.
_Avoid_: initial salary, starting salary, offer

**Employment Type**:
The legal shape of a Position as of a date — CLT, PJ, contract, internship — held on Standing Terms
rather than on the Position, so a conversion at the same employer is an event and not a new job.
Tenure stays whole, and the gross figure moves for a reason visible on the timeline.
_Avoid_: contract type, regime, status

**Promotion**:
A Position Event carrying both a new title and new compensation. A title change with no money and a
raise with no title are each ordinary settings of Standing Terms and neither is a Promotion — the
distinction is worth keeping because only one of the three is worth putting on a résumé.
_Avoid_: level up, advancement, step up

**Departure**:
The end of a Position: a date and a reason — resigned, laid off, contract ended, role eliminated.
Recorded plainly and without euphemism, because the reason is the part you will want years later.
_Avoid_: termination, quitting, exit, offboarding

**Current Position**:
A Position with no Departure. There may be more than one — contract work alongside a salaried job is
ordinary — so nothing in Hyperion assumes a single present employer.
_Avoid_: active job, present role, current job

**Tenure**:
How long a Position has run: its start date to its Departure, or to today while it is current.
Unbroken by title changes, promotions or a change of Employment Type.
_Avoid_: seniority, time served, length of service

### Compensation

**Currency**:
Belongs to an amount, never to the deployment. A Position carries the currency it pays in and its
events inherit it, so a career that crosses a border is an ordinary record rather than an edge case.
Amounts are stored as integer minor units at that currency's own precision — which differs between
currencies, and so is stored rather than assumed. An amount is always the pair, everywhere.
_Avoid_: locale, units, base currency

**Recorded Rate**:
An exchange rate a User entered, for one currency pair on one date. Hyperion asks for a rate only
when a comparison actually needs one, remembers the answer, and fetches none — the same rule that
keeps inflation series and share prices out of the app.
_Avoid_: FX rate, conversion rate, market rate

**Converted**:
The mark carried by any figure that has crossed currencies, shown alongside the Recorded Rate used
and its date. Converted figures are never folded silently into a total, and the native-currency view
is always the default — what an amount was worth somewhere else is a judgement about cost of living,
and Hyperion is not equipped to make it. An aggregation asked to mix currencies without a rate says
so rather than producing a number.
_Avoid_: normalised, adjusted, in your currency

**Total Compensation**:
For a period: the Standing Terms' base salary and Target Bonus, plus whatever equity actually vested
during it, at grant value and never at a market value. Shorthand **total comp**. Whatever vested,
rather than a grant divided by its length, because overlapping grants and cliffs make those two
different figures — a refresher granted in March with a one-year cliff contributes nothing that year,
and the divided figure would count money nobody has received. Denominated in its Position's currency,
and Converted only where a comparison demands it.
_Avoid_: salary, package, earnings, TC (in the UI)

**Target Bonus**:
The bonus a Position's terms promise, as a figure — distinct from a bonus that actually landed, which
is a Payment on the date it was paid. Confusing the two is how a compensation history stops matching
anybody's memory of it.
_Avoid_: bonus (unqualified), variable pay

**Equity Grant**:
An award recorded against a Position: its value at grant, and the Tranches it vests in. Hyperion
records what a grant was worth when it was made and never what it is worth now, because knowing that
would require a price feed it deliberately does not have.
_Avoid_: stock, shares, RSUs, options

**Tranche**:
One dated portion of an Equity Grant, and the amount vesting on that date. Any schedule — four years
with a one-year cliff, monthly, quarterly, whatever a lawyer invented — reduces to a list of these,
so Hyperion stores the list and never the rule behind it. A form with the usual presets generates
them when the grant is entered, so nobody types thirty rows by hand. A vested Tranche is a Payment.
_Avoid_: vest, instalment, schedule

**Vested to Date**:
How much of an Equity Grant has vested as of the date being viewed, valued at grant. A past date
reports what had vested then, never today's figure. Computed by summing Tranches rather than by
modelling the rule that produced them.
_Avoid_: equity value, current value, unvested balance

**Switch Premium**:
The step change in Total Compensation from a Position's last Standing Terms to the Starting Terms of
the next one. What changing jobs paid you.
_Avoid_: job hop gain, jump, raise

**Stay Premium**:
The compound growth in Total Compensation across the Standing Terms set within a single Position.
What staying paid you. Read against Switch Premium it is the most actionable figure Hyperion computes,
and it is the reason the compensation history is worth keeping at all.
_Avoid_: internal raise, merit increase, annual increase

### Applications

**Advertised Range**:
What a posting claimed the job pays, with its own currency. A claim about a market, recorded because
it is worth knowing later how far it sat from what was actually offered.
_Avoid_: salary range, budget, expected salary

**Offered Terms**:
What an employer actually put in writing — base, Target Bonus, Employment Type, start date, in their
currency. Distinct from the Advertised Range in every way that matters, and the thing Landing carries
across to become the Position's Starting Terms. An offer read beside your Current Position's Standing
Terms is the whole of what an offer-comparison feature would have been.
_Avoid_: offer, package, final salary

**Stage**:
A named point in the pipeline: Saved, Applied, Screen, Interview, Offer, Rejected, Withdrawn, Landed.
A fixed list, not a user-defined workflow — a funnel only means something if every period measures the
same points.
_Avoid_: status (for the named point), step, phase, column

**Application Event**:
The record of an Application entering a Stage on a date. The event log is the entire pipeline history;
nothing about where an Application stands is stored anywhere else. Response times, funnels and
conversion rates are all read from these.
_Avoid_: status change, transition, history entry

**Status**:
The Stage of an Application's most recent event. Derived and never stored — a status field and an
event log disagree eventually, and once they do neither can be trusted.
_Avoid_: state, stored status

**Terminal Stage**:
A Stage an Application does not leave: Rejected, Withdrawn, Landed.
_Avoid_: closed, final, dead, archived

**Open Application**:
One whose Status is not a Terminal Stage. The set the attention view is drawn from.
_Avoid_: active, live, in progress, pending

**Stalled**:
An Open Application whose most recent Application Event is older than the Stall Threshold. Derived
like Status, and reported neutrally as a queue to look at rather than as an error or an accusation —
silence is the normal case in a job search, not a failure. Being visible when you open the app is the
whole mechanism; nothing is sent anywhere.
_Avoid_: ghosted, dead, ignored, stale, abandoned

**Stall Threshold**:
The number of days of silence after which an Open Application counts as Stalled. A per-User setting,
and a number worth tuning only against real applications going quiet.
_Avoid_: timeout, cutoff, SLA

**Source**:
How an Application arrived — a named board, a referral, a recruiter's message, something you found.
The dimension response rates are most worth broken down by, and the one that survived when grouping
applications into named campaigns did not.
_Avoid_: channel, origin, via

**Interview**:
A scheduled conversation with a prospective employer: when, who, its format, and afterwards the notes
on how it went. Distinct from the Interview Stage — entering a Stage is a fact about the pipeline and
belongs in the event log, while an Interview is an appointment that may be in the future. It cannot
be an Application Event without breaking the rule that Status is the latest event's Stage, since a
scheduled interview would otherwise put the Application in Interview before anybody had interviewed.
Hyperion displays it and never alerts on it; the calendar owns that.
_Avoid_: meeting, call, screen (for a scheduled Interview)

**Prior Application**:
An Application already recorded that matches one being entered — by posting URL, or by company with a
similar title. Surfaced as context and never as an obstacle: applying again once time has passed is
legitimate, and Hyperion has no opinion on how much time is enough. It reports how long ago and what
came of it, links to the notes written then, and pre-fills the new Application from the old one if you
go again. The single case it raises its voice for is an Open Application to the same posting, which is
a slip rather than a decision.
_Avoid_: duplicate, already applied, blocked, conflict

### Achievements

**Achievement**:
A dated record of something you did and what it changed, belonging to the Position held at the time —
every Achievement has exactly one, never none. A review is written for one employer at a time, and an
Achievement with nowhere to belong is the shape of the thing this app exists to avoid: a claim nobody
can place. Written when it happened rather than remembered at review time, which is the entire point of
having it. Recorded in one line from one always-visible box: anything that makes logging slower than
that makes the log empty. Deleting a Position is refused while any Achievement still belongs to it,
named plainly with the count, rather than orphaning the record.
_Avoid_: accomplishment, win, brag, note, entry

**Impact**:
The optional figure or outcome on an Achievement — what moved and by how much. Absent is normal and
carries no penalty: not everything worth recording is measurable, and inventing a number to fill the
field defeats the purpose of the field.
_Avoid_: metric, result, KPI, outcome

### Documents

**Document**:
A résumé or cover letter as it was actually sent: a label, the file itself, and the Applications it
went out with. Stored as bytes inside the database rather than on a volume, so that copying the one
file remains a complete backup and a record can never point at something a tidied folder removed.
Individual Documents download normally; a whole-deployment export is a zip of data and files rather
than a single JSON document.
_Avoid_: file, attachment, résumé (unqualified), asset

### Capture and suggestions

**Capture**:
A job posting pulled in from the browser as a URL, a page title and raw visible text, with no fields
parsed out of it. It becomes an Application when somebody fills the fields in, or when the AI layer
proposes them; until then it is only text. Hyperion has no per-site parsers and wants none — every
board changes its markup eventually, and maintaining five scrapers is how a personal project acquires
a second job.
_Avoid_: scrape, import, clip, sync

**Suggestion**:
Something Hyperion drafts or proposes but never applies — fields extracted from a Capture, a résumé
bullet drafted from an Achievement, a self-assessment assembled from six months of them. Suggestions
are always confirmed, edited or dismissed by a person, because a record that edits itself is no longer
evidence.
_Avoid_: auto-update, detection, inference, AI action

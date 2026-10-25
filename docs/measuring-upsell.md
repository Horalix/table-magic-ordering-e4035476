# Measuring what the suggestions earned

How the app decides whether its own recommendation engine is worth having, and
why several obvious ways of answering that are wrong.

Enforcement lives in `20260803002004_dc2b05ee-….sql` (experiment integrity —
originally written as `20260804090000_experiment_integrity.sql`, applied live
under Lovable's timestamp), `20260803002115_d9fa33c5-….sql` (the decision
ledger, originally `20260804090100_decision_ledger.sql`),
`20260804090600_app_impact.sql`, and `20261024150000_analytics_fixes.sql`
(projection window, per-visit revenue per guest, verified acceptance, the
shared "looked at, not ordered" rule). Covered by
`supabase/tests/experiment-integrity.test.ts`, `decision-ledger.test.ts`,
`maintenance-and-impact.test.ts` and `analytics-fixes.test.ts`.

---

## 1. The rule

**Fix the evidence before building anything that learns from it.**

A sophisticated ranker on untrustworthy inputs is worse than a simple one on
trustworthy inputs, because it is confidently wrong. Every decision below
follows from that.

## 2. Three ways the measurement was wrong

All three inflated confidence, which is the dangerous direction — a number that
looks solid and is not.

### Wrong unit of analysis

Treatment is assigned per **table session**. The comparison averaged per
**order**. Three rounds from one table are not three independent observations —
they share a party, an occasion and an appetite. Treating them as independent
understates the standard error and can manufacture significance from nothing.

There is a regression test for this: both arms spend identically per visit, but
the treatment arm splits its spend across three rounds. Per-order maths sees 90
tightly-clustered samples against 30 and reports a confident gap. Per session
the difference is zero.

The unit is now `session_outcomes`, one row per visit.

### Tips counted as uplift

`orders.total` is items **plus tip**. A tip is the guest's generosity, not an
effect of a suggestion, and it is high variance — so including it both biased
the mean and widened the interval, making a real effect harder to see and a
fake one easier. Refunds were ignored entirely.

`net_sales = items − tip − refunded`.

### The experiment re-bucketed its own history

Membership was a hash of the *current* holdout percentage, evaluated at read
time. Moving the dial silently reassigned past orders. Assignment is now a
stored random draw written once at session open, and a trigger refuses to let
it change.

## 3. Experiments are versioned

The old design could only answer "suggestions versus none". The moment the
ranking policy changes, that question changes with it, and mixing both in one
report makes the result meaningless.

- `experiments(name, policy_version, holdout_pct, started_at, ended_at)`
- Only one runs at a time — two overlapping experiments assigning the same
  sessions would interfere and neither would mean anything.
- A policy change opens a **new** experiment. Never append.

## 4. Nothing is reported until the experiment is healthy

| Check | What it catches |
| --- | --- |
| **SRM** | A configured 10% holdout delivering 30%. Something is assigning wrongly and the estimate is worthless, so the result is **suppressed**, not caveated. |
| **Power** | Says how many more sessions are needed and roughly how many days. "Too early" tells an owner nothing and invites them to refresh for a fortnight. |
| **Guardrails** | Ratings and time-to-served per arm. An engine that lifts spend while degrading service has not won, and nothing previously would have noticed. |

Status is one of `not_running`, `too_early`, `invalid_srm`,
`no_measurable_effect`, `positive`, `negative`. **`no_measurable_effect` is a
real finding**, not a missing one.

## 5. The money projection is deliberately cautious

Computed from **`ci_low`**, never the point estimate. A dashboard that
overstates once is never believed again, so the figure shown is the one the
data supports even at the pessimistic end.

The daily rate behind it is **visits per day the experiment actually ran**
inside the window (`measured_days`, floored at one day), not visits per day of
the window. Dividing by the whole window understated the money by the share of
the window that predated the experiment — five times over for an experiment
started six days into a 30-day view.

## 6. The decision ledger

Client-fired events could not be trusted in four ways: they fired on mount, a
remount re-fired them, the cart placement rendered from two components, and
"accepted" meant a tap on an order that might later be cancelled.

Now:

- **Every decision is recorded server-side** — the chosen item, the shortlist,
  the policy version, the arm, and the action probability. Propensities are
  logged while they are trivially `1.0`, because retrofitting them is
  impossible and without them no future policy can be evaluated off-policy.
- **Including the decision to suggest nothing.** That row is the denominator.
  Without it you can measure the acceptance rate of suggestions that were made,
  but never how often the engine had nothing useful to say.
- **An impression is a sighting** — half-visible for 400 ms — deduped by
  primary key, so the count is right regardless of what any client does.
- **Acceptance means paid for**, joined through `suggestion_conversions.decision_id`
  to a completed order.

Menu Intelligence reads acceptance this way (`suggestion_impact().seen` and
`.paid`). The older client counts (`shown`, `accepted`) are still returned,
because they are the only history from before the ledger, and the page labels
them **taps** whenever it has to fall back to them.

## 7. Attributed revenue is an upper bound, and says so

It counts the whole line every time a guest takes a suggestion, including the
coffee they were always going to order. It is useful and it is not causal. On
the impact page it sits **below** the holdout figure, explicitly labelled.

The same goes for "average order with a suggestion vs without" in Menu
Intelligence: guests who take a suggestion were already the bigger spenders,
so the gap is selection as much as effect. It sits under the holdout card,
labelled *upper bound, not causal*.

Menu Intelligence shows only a short holdout summary — same function, same
type, per visit and in net sales — and links to the impact page for the full
read (split health, power, guardrails). Before, it read fields the function no
longer returned and showed zeros for both arms.

**Revenue per guest** is per visit: a party's whole net spend divided by its
head count once. Dividing each order by the full party, as it did before,
counted a four-top's three rounds as three quarter-sized guests.

## 8. Contribution margin, only if you enter costs

`margin_score` is an ordinal 0–100 a manager sets to say "push this one". No
arithmetic turns it into money. Set `menu_items.food_cost` and the impact page
can report margin; until then it reports net sales and states the coverage.

## 9. Thompson sampling, gated

The sampler **is built**, and it is **off**. `bandit_readiness()` decides when
it turns on:

| Check | Status |
| --- | --- |
| Impressions server-verified and deduped | passes |
| Acceptance linked to a paid outcome | passes |
| Action probabilities logged | passes |
| ≥2000 decisions | needs real service data |
| ≥15 pairs with 50+ impressions each | needs real service data |
| Any verified conversions | needs real service data |

The three failures are one fact stated three ways: none of this has run in a
real service yet. At roughly 50 sessions a day it is three to four weeks.

### What it changes

`smoothed_acceptance` returns the posterior **mean** and throws the variance
away:

| | shown | accepted | score | actually plausible |
| --- | --- | --- | --- | --- |
| A | 4 | 4 | 0.294 | 8%–51% |
| B | 400 | 100 | 0.244 | 20%–29% |

A outranks B permanently on four data points, and nothing in the system knows
one of those numbers is a guess. `sample_acceptance` draws from each posterior
instead: A still leads, as it should on the evidence, but takes **67.9%** of
the impressions rather than 100%, so B keeps the rest and A's guess resolves
into a fact within a couple of weeks. A pair that is genuinely bad — 2% over
400 shows — wins **0.0%**, so exploring does not cost exploitation.

The existing exploration term already favours new pairs, but it keys on
**novelty**: `0.15 × 30/(30+shown)`. A pair seen 100 times with wildly
inconsistent results decays exactly like one seen 100 times with consistent
results, though the first plainly deserves more testing.

Expect a modest gain. Bandits pay off with many arms and heavy traffic; a café
with ~50 items finds its good pairings a few weeks sooner and wastes fewer
impressions in the meantime. Phases 3 and 4 — seeing the whole visit, learning
pairs across rounds — are what made suggestions *better*. This only allocates
impressions between candidates the ranker already produced.

### Turning on

`maybe_enable_sampling()` runs nightly inside `run_daily_maintenance()`. It is
one-way: it will switch sampling **on**, never off, because "off" is a
judgement about whether the thing is working and that belongs to a person, not
to a cron job that has just watched a quiet week.

It also **closes the running experiment**, because an experiment compares one
policy against no suggestions and swapping the ranker underneath it would
average two treatments into a number describing neither. Start the next one
from the Impact page.

To stop it by hand:

```sql
UPDATE public.restaurant_settings SET reco_sampling_enabled = false WHERE id = 1;
```

### Propensities under sampling

Under a sampled policy the action probability is no longer 1.0 and is not
cheaply computable — it needs Monte Carlo over every candidate's posterior.
Rather than log a wrong number, each decision records the posterior **inputs**
per candidate, so the propensity can be reconstructed exactly offline if
anyone ever needs off-policy evaluation.

## 10. Regulars

`guest_profiles` is keyed on the **device** that opened a table, never a
person — phones get shared and replaced, and calling a client id an identity
produces confident nonsense about a tablet behind the bar.

Attribution is per session via `table_sessions.host_client_id`. A guest who
*joins* someone else's table is not a separate visit; their spend lands in the
host's session. That is a real limitation, stated rather than hidden.

`guest_forget_me` clears the phone, deletes the profile, unlinks the sessions,
**and rotates the local client id** — without that last step the device
rebuilds the same profile on its next visit and the deletion is cosmetic. The
orders survive: a privacy request must not put a hole in the day's
reconciliation.

## 11. Suggestions v3: what it learns from, and how to get an answer in a month

`20261025100000_reco_learning_v3.sql` and `20261025110000_reco_measurement.sql`.
Covered by `supabase/tests/reco-learning-v3.test.ts` and
`reco-measurement.test.ts`.

### The learning counts are the ledger's

Until v3 the nightly job still built `suggestion_stats` — the numbers the
ranker learns from and retires pairs by — out of browser events: a card could
count as "shown" without being the decision's choice, and a tap on an order
that was later cancelled counted as a success. Now, from the first decision
the ledger holds:

- **shown** is a decision whose dish was seen (an impression, or proof enough:
  a dismissal or a paid line), once per decision;
- **accepted** is that decision's dish on a completed order;
- **dismissed** still comes from browser events, joined by decision id, for
  diagnostics only.

Browser events count only for the time before the ledger began, and age out
of the 90-day window. `bandit_readiness()` has a new check,
`stats_learn_from_ledger`, that passes once 90% of counted sightings come from
the ledger. The card itself now reports a sighting only for the decision's
own dish.

### What changed in the ranking, briefly

- A pair is used only when its **EB05** — the pessimistic end of a shrunk
  observed/expected ratio — is above 1. Raw lift called two dishes ordered
  once, together, a perfect match. Orders fade with a 45-day half-life instead
  of disappearing at 90 days. `lift`, `confidence`, `pair_orders` and
  `a_orders` keep their old 90-day meaning for the screens that quote them.
- A dish with no history of its own can be suggested from its **section**:
  "burgers go with fries", offered as the fries that sell at this time of day.
- A new pair starts from what its dish does at the same placement elsewhere
  (`suggestion_priors`), not from one global guess. A pair is **retired** only
  when even the optimistic end of its record (95th percentile) is under the
  floor — "2 in 60" at a dish that sells at 6% elsewhere is bad luck, not a
  verdict.
- Candidates are ranked by **expected profit**, P(taken) × unit margin from
  `menu_unit_margins()`, against the best on the shortlist. Until a pair or
  its dish has a record, every candidate's P(taken) is the same guess, so the
  margin used is blended towards the shortlist average in proportion to how
  little is known: otherwise "expected profit" would just mean "most
  expensive", which the price rule exists to stop. `margin_score` is now a
  ±0.05 nudge.
- A dish this table has already seen suggested and passed over loses 0.15 per
  sighting. No alcohol before `reco_alcohol_from` (12:00), to a table with a
  kids' dish, or to a guest filtering for halal — curated pairs included.

The policy version is now `v3-profit` (`v3-profit-thompson` once sampling is
on), and the migration closes any experiment that was running.

### Why spend per visit takes so long, and what helps

Visits differ mostly because parties differ: a table of six spends five times
a table of one. That spread is noise as far as the comparison is concerned,
and it is large. The number of visits needed to see an effect δ on a mean
with spread σ, at 80% power and 5% significance, is

    visits = 7.85 · (σ/δ)² · (1/h + 1/(1 − h))        h = share held out

so a 10% holdout needs `(10 + 1.11) / 4 = 2.8` times the visits of a 50/50
split. Illustration only — the impact page computes it from real data: if σ
is 80% of the average visit and the effect is 5%, a 50/50 test needs about
8,000 visits; at 150 visits a day that is 54 days, and at 10% it is five
months.

Two things bring that into a month:

1. **Adjusting for what was known before any suggestion could act**
   (CUPED / ANCOVA). Covers, daypart, weekday or weekend, and the value of the
   cart when the engine was first asked — before it could have shown anything,
   in either arm — are combined into one predicted spend per visit, and the
   comparison is made on what that prediction does not explain. It estimates
   the same effect as the plain difference; when party size is what makes
   visits differ, its interval is several times narrower. The impact
   comparison returns it as `adjusted`, with `variance_reduction_pct` and its
   own `days_to_answer`. `status` is still the plain comparison.
   - Caveat: the first cart value is only recorded from v3 on; older visits
     use the average, which is honest (it carries no information) but helps
     less.
2. **Attach rates**, which move much more than spend and are much less noisy:
   - `attach.after_meal` — of visits with a main served, the share that then
     ordered a dessert or a hot drink;
   - `attach.drink_with_main` — of visits whose first round had a main, the
     share with a drink in that round.
   Each with a two-proportion interval. They answer "do the suggestions do
   what they are for" weeks before spend can.

`experiment_power()` now reports `days_to_answer` at the running split and
`days_to_answer_at_50`.

### Running a 3–4 week 50/50 test

The default holdout is unchanged (0: everybody sees suggestions). To measure:

1. **Admin → Service & suggestions → Measurement holdout**: set **50**, then
   press **Start measuring at 50%**. (The Impact page's button starts a 10%
   holdout; the number box alone starts nothing — assignment is recorded per
   table when it opens, under a running experiment.) Starting closes any
   experiment already running.
2. **Change nothing about the ranking for the duration**: weights, curated
   pairs you are unsure of, the alcohol time. A change mid-test blends two
   treatments into one number. One thing can change on its own: if the
   nightly job switches Thompson sampling on, it closes the experiment (the
   policy changed). If `bandit_readiness()` is close to passing, start the
   test after it does.
3. **Do not stop when it first looks good.** Peeking and stopping at the first
   significant day finds effects that are not there. Read it at the end of
   week three; let it run to week four if `adjusted.days_to_answer_at_50` says
   so.
4. **Read, in order**: `srm.healthy` (if false, nothing else counts);
   `guardrails` (ratings, minutes to served); `attach.after_meal` and
   `attach.drink_with_main`; `adjusted` for net spend per visit; the plain
   difference last.
5. **Stop it** (`stop_experiment`, which also sets the holdout back to 0), or
   keep a small ongoing holdout (5–10%) as a smoke alarm rather than a
   measurement.

It costs something: for those weeks half the tables see no suggestions. If
the suggestions work, that is real money not earned — the price of knowing
whether they do, paid once.

## 12. Relevance first, then profit (`20261025160000_reco_profit.sql`)

The engine's objective is the extra contribution margin a suggestion adds to
a visit — without the guest ever being offered something silly. So relevance
is a **gate**, not a weight:

- every dish has a kind (`reco_kind`: burger, pasta, breakfast, dessert,
  pastry, coffee, refresher, soft drink, ...);
- a candidate that is not one of the owner's pairings is considered only if
  `reco_fit` says its kind goes with something on the table; `reco_clash` and
  `reco_vetoed` remove what never belongs (a second main or side, cake before
  11:00, a croissant in the evening, sweets with a frappé, a kids' dish, an
  energy drink, a box for sharing);
- learned co-occurrence and popularity only *rank* what passed; if nothing
  passes, the card stays empty.

Among what passed, expected profit decides: P(taken) × unit margin. Before a
pair has a record, P(taken) is assumed to fall with the square of how far the
price overshoots a comfortable share of the table's average line (40% for a
drink or side, 80% for a dessert or starter), and the value term carries 30%
of its weight; both give way to the pair's own record as it builds. A table
with more people than drinks is offered one each at the cart and on the
running tab ("Just one" is always a tap away); the decision records the
quantity offered, the paid line what was bought.

`supabase/tests/reco-waiter-scenarios.test.ts` runs 70 tables at five times of
day on the real menu and fails if any first suggestion is one a good waiter
would not make. Regenerate the readable table with
`WAITER_REPORT=out.md npx vitest run supabase/tests/reco-waiter-scenarios.test.ts`.

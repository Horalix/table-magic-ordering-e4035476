# Measuring what the suggestions earned

How the app decides whether its own recommendation engine is worth having, and
why several obvious ways of answering that are wrong.

Enforcement lives in `20260804090000_experiment_integrity.sql`,
`20260804090100_decision_ledger.sql` and `20260804090600_app_impact.sql`,
covered by `supabase/tests/experiment-integrity.test.ts`,
`decision-ledger.test.ts` and `maintenance-and-impact.test.ts`.

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

## 7. Attributed revenue is an upper bound, and says so

It counts the whole line every time a guest takes a suggestion, including the
coffee they were always going to order. It is useful and it is not causal. On
the impact page it sits **below** the holdout figure, explicitly labelled.

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
instead, so A wins about a third of the impressions — enough to find out — and
then settles above B or falls away.

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

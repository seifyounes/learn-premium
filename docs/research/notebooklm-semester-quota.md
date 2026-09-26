# NotebookLM quota for a semester of Courses

Research for issue #28, as of **2026-09-26**. It answers one question: does one Google AI Pro
account make the Module media for five Courses in one semester? These are findings, not
decisions; the owner decides. It builds on #5 (`docs/research/notebooklm.md` on branch
`research/notebooklm`) and #12, and re-checks every limit against Google's own pages.

NotebookLM is now called **Gemini Notebook** (renamed 2026-07-16, see #5). Help pages live under
both `support.google.com/notebooklm` and `support.google.com/gemininotebook`. Unless a row says
otherwise, every source below was fetched on 2026-09-26.

## Verdict

**Covered, with a queue. Spread across the semester, the queue is at most 1 day a week. If all five
Courses' pre-midterm Materials land in the same week, it grows to 8 days, and to 16 days if the
whole semester's Materials land at once.** These figures use Google's published AI Pro counts (20
Video and 20 Audio Overviews a day). On 2026-09-02 Google moved Gemini Notebook to compute-based
limits and stopped publishing per-output numbers, so the real queue may be up to about 2× longer.
One measured run on the pilot Course (§5) would settle it.

## 1. What changed on 2026-09-02 (this matters most)

Google now has **two help pages that disagree**:

- **Upgrade page.** It still shows a per-feature table headed "Usage Limits (Subject to Change)",
  with a banner: "Starting on September 2, 2026, there will be changes to your usage limits"
  ([Help: Upgrade Gemini Notebook](https://support.google.com/gemininotebook/answer/16213268?hl=en)).
- **Usage limits page.** It says that from 2026-09-02 Gemini Notebook "will have compute-based
  usage limits". These weigh prompt complexity, the models and features used, chat length and
  specific features, and "the quota refreshes every 5 hours until you reach your weekly limit".
  Tiers are given only as multipliers: AI Plus is 2× standard, AI Pro 4× standard, and AI Ultra
  "5x or 20x higher than AI Pro". Studio shows each generation's "expected AI usage cost". When
  you run out, **Generate later** (web only) defers a generation for "a couple hours".
  Remaining usage is shown under Settings → Usage
  ([Help: Manage your usage limits](https://support.google.com/gemininotebook/answer/17670842?hl=en)).
- **Announcement.** The official post (2026-08-28, Yesul Shin, PM) says the limit factors "prompt
  complexity, chat length, number of sources, and the features you use", refreshes every five
  hours, and lets you defer outputs "like Video Overviews or Slide Decks"
  ([Google blog, 2026-08-28](https://blog.google/innovation-and-ai/products/gemini-notebook/new-flexible-usage-limits/)).
  It gives **no** per-output numbers and **no** weekly figure.

**Not confirmed from any primary source:**

- whether the old per-output daily counts still apply on top of the compute budget;
- how many Explainer videos, Deep Dives or infographics a Pro weekly budget buys;
- whether audio and video still have separate counters or now share one budget.

An inference to treat with care: under the old table Pro was 20 ÷ 3 ≈ **6.7×** Standard for
audio and video, but the new page says Pro is **4×** Standard. If Standard still buys about 3 of
each a day, Pro would buy about 12, which is roughly 0.6× the old figure. That is why §4 carries a
0.5× stress test.

## 2. Limits table (AI Pro and neighbours)

From the [Upgrade page](https://support.google.com/gemininotebook/answer/16213268?hl=en)
(fetched 2026-09-26; labelled "Subject to Change", see §1).

| Limit | Standard (free) | Plus | **Pro** | Ultra (20 TB plan) | Ultra (30 TB plan) |
|---|---|---|---|---|---|
| Notebooks | 100/user | 200/user | **500/user** | 500/user | 500/user |
| Sources | 50/notebook | 100/notebook | **300/notebook** | 500/notebook | 600/notebook |
| Audio Overviews | 3/day | 6/day | **20/day** | 100/day | 200/day |
| Video Overviews | 3/day | 6/day | **20/day** | 100/day | 200/day |
| Cinematic video (subset of video) | — | — | **2/day** | 10/day | 20/day |
| Infographics | "Limited" | "More limits" | **"High limits"** (no number) | "Higher limits" | "Highest limits" |
| Reports / Flashcards / Quizzes / Mind Maps | 10/day each | 20/day | 100/day | 500/day | 1K/day |
| Chats | 50/day | 200/day | 500/day | 2.5K/day | 5K/day |

- **Per account, not per notebook.** Notebooks are counted "/user" and sources "/notebook".
  "Sharing a notebook does not change the source limit for any collaborator" (same page). The day
  counts don't name their unit. The compute budget belongs to the plan, which means the account
  ([Help: usage limits](https://support.google.com/gemininotebook/answer/17670842?hl=en)).
- **Reset.** "Daily quotas are reset after 24 hours; monthly quotas are reset after 30 days"
  (Upgrade page). Under the compute model the budget "refreshes every 5 hours until you reach your
  weekly limit", and the UI shows a clock time such as "available after 3:00 PM" (usage page).
  There is **no fixed global reset time**; the window runs from your own usage. The length of
  the weekly window is **not published**.
- **Source size.** Each source can hold "up to 500,000 words or up to 200MB for uploaded files"
  ([Help: add sources](https://support.google.com/gemininotebook/answer/16215270?hl=en)). One
  Course notebook holding all its Materials sits far below 300 sources. (The 10 MB upload cap in
  #5 comes from Claude in Chrome, not from Google.)
- **Auto-generated artifacts are free.** Outputs generated automatically when sources are first
  added "are generated once and do not contribute to limits" (Upgrade page).
- **Concurrency.** Video and audio are "generated in the background, so you can generate other
  artifacts concurrently". A video "sometimes" takes more than 30 minutes, while audio and
  infographics take "a couple of minutes"
  ([Help: Video](https://support.google.com/gemininotebook/answer/16454555?hl=en),
  [Help: Audio](https://support.google.com/gemininotebook/answer/16212820?hl=en),
  [Help: Infographic](https://support.google.com/gemininotebook/answer/16758265?hl=en)).
  Generation time is not the bottleneck; quota is.
- **No top-ups for Notebook.** Google AI credits "get extra usage in Google Flow and Google
  Antigravity" only
  ([Google One Help: AI credits](https://support.google.com/googleone/answer/16287445?hl=en)).
  The I/O post says top-ups are "coming soon" to the Gemini app, and it does not mention Notebook
  ([Google blog, I/O 2026](https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/)).

## 3. Demand model

Rules from the ticket and #12:

- **Per Module:** 1 Explainer video, 1 Deep Dive audio and 1 infographic.
- **Per Exam sitting:** 1 Deep Dive audio.
- **Arabic on:** video and audio are doubled; the infographic stays English.
- **Regeneration:** up to one per output.
- **Semester:** 5 Courses × 10–14 Modules = **50–70 Modules**, and 5 × 2 sittings =
  **10 sittings**.

Formulas: **Video = M × L × R**, **Audio = (M + S) × L × R**, **Infographic = M × R**, where
M = Modules, S = sittings, L = languages (1 or 2) and R = regeneration factor (1 or 2). "Days" is
the Pro queue at 20 video and 20 audio a day, with separate counters, so the larger of the two
counts wins.

### Whole semester

| Case | M | Arabic | Regen | Video | Audio | Infographic | Days (20/20) | Days (0.5× stress) |
|---|---|---|---|---|---|---|---|---|
| Light | 50 | off | none | 50 | 60 | 50 | 3 | 6 |
| Typical-high | 70 | off | none | 70 | 80 | 70 | 4 | 8 |
| Arabic on all | 70 | all 5 | none | 140 | 160 | 70 | 8 | 16 |
| **Ceiling** | 70 | all 5 | every output | **280** | **320** | **140** | **16** | **32** |

### Worst-case week (all five Courses' pre-midterm Materials land together)

This assumes half the Modules (7 per Course, 35 in total) plus the 5 midterm sittings.

| Case | Video | Audio | Infographic | Days (20/20) | Days (0.5×) |
|---|---|---|---|---|---|
| Arabic off, no regen | 35 | 40 | 35 | 2 | 4 |
| Arabic on all, no regen | 70 | 80 | 35 | 4 | 8 |
| **Arabic on all, regen every output** | **140** | **160** | **70** | **8** | **16** |

The "whole semester dumped at once" case is the Ceiling row above: **16 days** (32 in the stress
test).

### Spread out

This assumes about 14 teaching weeks, an assumed figure: roughly 5 Modules arrive a week (1 per
Course). At the ceiling (Arabic on, every output regenerated) a week needs 20 video, 20 audio and
10 infographics. That is **1 day of Pro quota a week** (2 in the stress test). Each exam week
adds 5 sittings × 2 languages × 2 = 20 audio, or 1 more day. Every weekly case fits well inside a
week.

**Infographics** peak at 140 a semester, or 70 in the worst week. Google publishes no Pro number
("High limits"), so this can't be checked on paper. It is **unconfirmed**.

## 4. Reading the numbers

- Media never blocks a Module (#12), so a queue only delays media deploys; it never delays study
  content.
- The ceiling assumes every output is regenerated. #12's rule is one corrective regeneration
  **only on error**, so real demand should sit near the "no regen" rows plus a margin.
- One shared media queue across Courses (#27) drains a pre-midterm spike in 4–8 days at published
  counts. Per-Course queues would compete for the same account budget anyway, because limits are
  per account.
- Order the queue as English first, then Arabic, then regenerations. The media students need
  first then lands in the first 2–4 days even in the worst week.

## 5. Options (prices from Google, fetched 2026-09-26)

Egypt prices are from [gemini.google/eg/subscriptions](https://gemini.google/eg/subscriptions/?hl=en).
US prices are from [gemini.google/us/subscriptions](https://gemini.google/us/subscriptions/?hl=en).

| Option | Monthly price | Effect on the queue | Notes |
|---|---|---|---|
| **A. Stay on AI Pro, one shared queue** (English → Arabic → regen), using Generate later | 939.99 EGP ($19.99), no extra cost | Worst week: 8 days (16 at 0.5×); spread out: ≤1 day a week | Fits "media never blocks". Zero cost. |
| **B. Trim demand**: Arabic only where the toggle is on, regen only on failure, English-only sitting audio | none | The ceiling semester drops toward 4–8 days | Product choice; changes #12's rules |
| **C. AI Ultra 5× for the crunch month only** | 2,199.99 EGP ($99.99); +1,260 EGP over Pro for that month | 5× Pro (100/100 a day on the old table): whole semester in ≤4 days | Whether a mid-cycle upgrade or downgrade is prorated was **not checked** |
| D. AI Ultra 20× | 8,799.99 EGP ($199.99) | 20× Pro | Overkill for this demand |
| **E. Second account on AI Plus** | 249.99 EGP ($4.99) | +6 video and +6 audio a day on the old table (+30%) | Cheapest paid add-on. Needs its own Chrome profile and its own notebooks, and only Seif can create it. |
| F. Second account on AI Pro | 939.99 EGP | Doubles throughput | Cheaper than Ultra 5× but only 2× |
| G. Family-group member on Seif's AI Pro | none | Possibly a second full Pro budget | See the note below |
| H. Buy AI credits | — | **Not available** for Gemini Notebook | Credits cover Flow and Antigravity only |
| I. Student offer | Plus free for one year (Egypt page, "ending soon"); Pro free for one year (US page) | As option E, at no cost | The Egypt offer is Plus, not Pro. Eligibility wasn't checked. |

Notes:

- **Family sharing.** Google lists Gemini Notebook among the AI benefits shared with a family
  group. It names only Flow and Antigravity as having limits "shared by the entire family group"
  ([Google One Help: share with family](https://support.google.com/googleone/answer/9004015?hl=en)),
  so each member *probably* has their own Notebook budget. That is **not stated explicitly**.
  A family group is meant for actual family members.
- **ToS on multiple accounts.** Google's Terms of Service, its Generative AI Prohibited Use
  Policy and the Google One terms contain **no clause against holding a second account or a second
  subscription** ([Terms](https://policies.google.com/terms?hl=en-US),
  [Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy?hl=en-US),
  [Google One terms](https://one.google.com/terms-of-service?hl=en)). The AI policy does bar
  "circumvention of abuse protections or safety filters" and "abuse of… Google's… services".
  A second **paid** subscription is clearly fine. Spinning up accounts purely to dodge usage
  limits is a grey area, and nothing in Google's pages sanctions it. This is not legal advice.
- **Ultra plan mapping.** The Upgrade page labels the Ultra columns "20 TB Plan" and "30 TB Plan",
  while the price pages sell "5×" and "20×" Ultra. That 30 TB = 20× is **assumed, not
  confirmed**.

## 6. Recommended next check (cheap, decisive)

On the pilot Course (ML, 11 Modules), open Settings → Usage in Seif's own signed-in profile.
Record the percentage one Explainer video, one Deep Dive and one infographic each consume, plus
the weekly-limit figure. That turns §3 into exact days. Seif should do this himself; agents must
not sign in.

## Unconfirmed / could not verify from a primary source

- Per-output counts under the 2026-09-02 compute-based model, and the weekly Pro limit (§1).
- A numeric infographic limit on any tier.
- Whether audio and video now draw on one pooled budget.
- Whether family-group members get separate Gemini Notebook budgets.
- Proration of a mid-cycle Ultra upgrade.
- The Ultra "30 TB" to "20×" mapping.
- The 14-week semester and 7-Modules-before-midterm split, which are assumptions and not Google
  facts.

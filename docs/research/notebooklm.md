# NotebookLM: outputs, limits, and automation routes

Research for issue #5, as of **2026-09-25**. Primary sources only (Google Help Centre, Google
blogs, Google Cloud docs, Anthropic docs, source repos). Findings, not decisions. The owner
decides.

## 0. Name change: NotebookLM is now "Gemini Notebook"

- Google renamed NotebookLM to **Gemini Notebook** on 2026-07-16. It is still a standalone
  product, and its notebooks now also sync into the Gemini app (and later Search AI Mode).
  Source: [Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/).
- Old links redirect ([Workspace Updates](https://workspaceupdates.googleblog.com/2026/07/notebooklm-now-gemini-notebook.html)).
  The app host is now `notebook.google.com`. A request to `notebooklm.google.com` returns a
  301 redirect to it (checked with `curl -I` on 2026-09-25).
- The same announcement adds a "secure cloud computer" to each notebook, so it can run code on
  its sources. It rolls out to Ultra and Workspace business first, then Pro "over the coming
  weeks" ([Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/)).
- The Help Centre now lives at both `support.google.com/notebooklm` and
  `support.google.com/gemininotebook`. This doc says "NotebookLM" because the ticket and
  `CLAUDE.md` do.

## 1. Output types (Studio panel)

The Studio panel can make Notes, Audio Overviews, Video Overviews, Mind Maps, Reports, Data
Tables, Flashcards/Quizzes, Slide Decks and Infographics
([Help: create a notebook](https://support.google.com/gemininotebook/answer/16206563?hl=en)).

| Output | Options / styles | Steering prompt | Arabic | Download / export | Source |
|---|---|---|---|---|---|
| **Audio Overview** | Deep Dive (default), Brief (<2 min, one speaker), Critique, Debate. Length Shorter/Default/Longer (**English only**). Interactive "join" mode (English only). | Yes: focus topics, expertise level | Yes, MSA and Egyptian colloquial. 80+ languages. | "Download" (file type not stated by Google; libraries save MP3). Public link possible. | [Help: Audio](https://support.google.com/gemininotebook/answer/16212820?hl=en) |
| **Video Overview** | Formats: **Explainer**, **Short** (~60 s), **Cinematic**. Visual styles (18+, not for Cinematic/Short): Classic, Whiteboard, Watercolor, Retro Print, Heritage, Paper-craft, Kawaii, Anime, auto, or **Custom** (you describe it). | Yes: suggested or custom topic | Explainer: 50+ languages incl. both Arabics. Short: 45+ incl. Arabic. **Cinematic: English only, 18+.** | "Download" (Google gives no format; libraries save MP4). Can take **>30 min** to generate. | [Help: Video](https://support.google.com/notebooklm/answer/16454555?hl=en) |
| **Slide Deck** | Detailed Deck or Presenter Slides; short/default/long. Per-slide revisions (each revision makes a **new deck**, and revisions **ignore the sources**). 18+. | Yes: free-text prompt | Output-language picker (list not given) | **PDF** or **PPTX** | [Help: Slides](https://support.google.com/notebooklm/answer/16757456?hl=en), [Workspace Updates, Mar 2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html) |
| **Infographic** | Square/Portrait/Landscape; Concise/Standard/Detailed (beta). Styles: Sketch Note, Kawaii, Professional, Scientific, Anime, Clay, Editorial, Instructional, Bento Grid, Bricks, or auto. 18+. | Yes: style, colour, focus | Output-language picker | **PNG** | [Help: Infographic](https://support.google.com/gemininotebook/answer/16758265?hl=en), [Workspace Updates, Mar 2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html) |
| **Flashcards / Quiz** | Difficulty easy/medium/hard; quantity fewer/standard/more. Progress saved ("Got it"/"Missed it"), shuffle, retake missed cards, "Explain". | Yes | Not stated per feature | Flashcards: **CSV**. Quiz: no export in the UI. | [Help: Flashcards/Quizzes](https://support.google.com/gemininotebook/answer/16958963?hl=en) |
| **Mind Map** | Interactive branching map: expand/collapse, click a node to ask about it. Not on mobile. | No (made from the sources) | Not stated | "Download" (format not stated) | [Help: Mind Maps](https://support.google.com/gemininotebook/answer/16212283?hl=en) |
| **Report** | Document reports (FAQ, study guide, briefing doc, custom, AI-suggested). **Interactive reports** with embedded Studio content, web only ("Learning Overview" template). | Yes: edit the template | Output language applies to study guides | **Export to Docs**. Tables inside go to Sheets. | [Help: Reports](https://support.google.com/gemininotebook/answer/18323649?hl=en), [Help: create a notebook](https://support.google.com/gemininotebook/answer/16206563?hl=en) |
| **Data Table** | Structure described in natural language | Yes | Not stated | **Export to Sheets**: the table goes in tab 1, citations in tab 2 | [Help: create a notebook](https://support.google.com/gemininotebook/answer/16206563?hl=en) |

Notes that matter for learn-premium:

- **Languages.** Output language is an **account-level** setting. It defaults to your Google
  Account language, and "different features may support different languages"
  ([Help: output language](https://support.google.com/gemininotebook/answer/16261963?hl=en&co=GENIE.Platform%3DDesktop)).
  Both Arabics are on the list. One unofficial library found that the interface locale was
  silently overriding the language argument
  ([roomi-fields README v3.1.x note](https://github.com/roomi-fields/notebooklm-mcp)). Any
  Arabic run must check the language of what comes back.
- **Age gate.** Cinematic video, visual styles, slide decks, infographics and parts of
  interactive reports require an 18+ account (see the rows above).
- **Accuracy.** Google's own pages warn that Slide Decks, Infographics, Reports and Audio "may
  contain inaccuracies" (same Help pages). v1-style accuracy gates would still be needed.
- **PPTX editability.** Google doesn't say whether exported PPTX text can be edited. Community
  converters exist that turn NotebookLM PDFs into PPTX with editable text layers
  ([NBLM2PPTX](https://github.com/laihenyi/NBLM2PPTX),
  [NotebookLM2PPT](https://github.com/elliottzheng/NotebookLM2PPT)), which suggests decks are
  largely image-based. **Unverified.**
- **Play Books sources** can block downloads and public sharing (Video, Flashcards, public-notebook Help pages).

### Sources in

Sources can be PDFs, Google Docs/Slides/Sheets, Microsoft Office files, images, audio (MP3,
WAV), EPUB, URLs, YouTube, CSV and Gemini chats. Each source can be up to **500,000 words or
200 MB**. Drive sources re-sync when the notebook opens. Audio transcription covers 50+
languages including Arabic. Google doesn't say how scanned PDFs (OCR) are handled
([Help: add sources](https://support.google.com/gemininotebook/answer/16215270?hl=en&co=GENIE.Platform%3DDesktop)).

## 2. Limits per plan tier

From the [upgrade / limits page](https://support.google.com/notebooklm/answer/16213268). The
page says new limits apply **from 2026-09-02**. Daily quotas reset after 24 h, monthly ones
after 30 days.

| | Standard (free) | Plus (Google AI Plus) | **Pro** (Google AI Pro; some Workspace/Edu) | Ultra 20 TB (Google AI Ultra) | Ultra 30 TB |
|---|---|---|---|---|---|
| Notebooks | 100 | 200 | 500 | 500 | 500 |
| Sources / notebook | 50 | 100 | 300 | 500 | 600 |
| Chats / day | 50 | 200 | 500 | 2.5K | 5K |
| Audio Overviews / day | 3 | 6 | 20 | 100 | 200 |
| Video Overviews / day | 3 | 6 | 20 | 100 (Cinematic 10) | 200 (Cinematic 20) |
| Reports / Flashcards / Quizzes / day | 10 each | 20 | 100 | 500 | 1K |
| Mind Maps / day | 10 | 20 | 100 | 500 | 1K |
| Deep Research | 10 / month | 3 / day | 20 / day | 75 / day | 200 / day |
| Infographics, Slide Decks (+ revisions), Data Tables | "Limited" | "More" | "High" | "Higher" | "Highest" (no numbers published) |
| Watermark removal | No | No | **Yes** | Yes | Yes (except India, S. Korea, Vietnam) |

- The mapping from tier to subscription (Standard = free Gmail, Plus = Google AI Plus, Pro =
  Google AI Pro, Ultra = Google AI Ultra) is from the same page.
- The owner's exact plan isn't stated in the repo. **If it's Google AI Pro**, the working
  numbers are 20 audio, 20 video, 100 quizzes/flashcards/reports/mind maps a day and 300
  sources per notebook. Cinematic video is available on AI Pro/Ultra
  ([Workspace Updates, Mar 2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html)),
  but Google publishes a separate Cinematic cap only for Ultra.
- Regional pricing is shown in local currency. From Egypt the plans page showed AI Plus
  249.99 EGP/mo, AI Pro 939.99 EGP/mo, and AI Ultra from 2,199.99 EGP/mo
  ([gemini.google/subscriptions](https://gemini.google/subscriptions/), fetched 2026-09-25).

## 3. Download, share, embed

- **Download** is available per artifact: audio, video, slides (PDF/PPTX), infographic
  (PNG), mind map and flashcards (CSV). Reports go to Docs and Data Tables to Sheets. Quizzes
  have no UI export (§1 table).
- **Public sharing** is for consumer accounts only. A notebook can be made public; viewers need a
  Google account. The owner of a public notebook can share **individual artifacts** by link, and
  "anyone who has the link… can view them, even if they are not signed in". "Chat view" hides
  sources and artifacts but **does not revoke** viewers' underlying access. Public sharing is off
  for Workspace Enterprise/Education
  ([Help: public notebooks](https://support.google.com/gemininotebook/answer/16322204?hl=en)).
- **Embedding.** Google documents no embed/iframe feature. The app host sends
  `X-Frame-Options: DENY` (`notebook.google.com`, checked 2026-09-25), so it can't be framed. In
  practice, "embed" means downloading the MP4/MP3/PNG/PDF and self-hosting it in the Study site,
  or linking out to a public artifact.

## 4. Official APIs: does anything change the picture?

- **Consumer / Google AI plans: no API.** Google has no public API or official MCP server for
  the consumer product. An "Official NotebookLM MCP Server" request on `google/mcp` has been
  open since 2026-02-02 ([google/mcp#19](https://github.com/google/mcp/issues/19)).
- **Gemini Notebook Enterprise** (Google Cloud; standalone or part of Gemini Enterprise). It has
  data residency, IdP auth and Office sources. It **can't share publicly**: sharing stays within
  the Cloud project. Its UI lives at `notebook.cloud.google.com`. Limits include 500 queries and
  20 audio overviews per user per day
  ([Enterprise overview](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/overview)).
  Licences come as a 14-day trial, or monthly/annual subscriptions of **15 to 5,000 seats**. The
  page publishes no price ([licensing](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/set-up-licensing)).
  - Its REST API (v1alpha, **Pre-GA**, OAuth via `gcloud`) covers `notebooks.create/get/listRecentlyViewed/batchDelete/share`
    ([notebooks API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks)),
    `sources.batchCreate/uploadFile`
    ([sources API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks-sources)),
    and `audioOverviews.create/delete`, one per notebook, with no documented download method
    ([audio API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-audio-overview)).
  - **There is no API for video, slides, infographics, quizzes, flashcards, mind maps, reports or
    chat.**
- **Standalone Podcast API** (Discovery Engine, MP3 out, <100K tokens in). It is
  **deprecated, and Google is not allowlisting new customers**
  ([Podcast API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/podcast-api)).
- **Net:** the official route covers only notebook/source setup and audio, needs an enterprise
  licence, and can't do the outputs a Study site wants most (video, slides, quizzes). It doesn't
  change the picture for learn-premium.

## 5. Automation routes

### ToS baseline (applies to every route on a consumer account)

The [Google Terms of Service](https://policies.google.com/terms?hl=en-US) (effective
2026-07-30) forbid:

- "using automated means to access content from any of our services in violation of the
  machine-readable instructions on our web pages"
- "reverse engineering our services or underlying technology… to extract trade secrets"
- "bypassing our systems or protective measures"

Google may suspend or terminate access for material or repeated breach. For the robots.txt
angle:

- `notebooklm.google/robots.txt` (the marketing site) is `Allow: /`.
- `notebooklm.google.com/robots.txt` and `notebook.google.com/robots.txt` redirect to Google
  sign-in, so the app host publishes no machine-readable rule either way (checked 2026-09-25).
- NotebookLM runs under the Google ToS for personal accounts and the Workspace ToS for work
  accounts ([Help: privacy & terms](https://support.google.com/notebooklm/answer/17004255?hl=en)).

**Assessment, not legal advice:** automating the UI is a grey zone. Calling the private RPCs
directly is closer to "reverse engineering" and "bypassing". I found no public report of a
NotebookLM-specific account ban in the two biggest libraries' issue trackers (searched
ban/suspended/blocked/captcha, 2026-09-25). The library authors themselves advise a
**dedicated Google account** for automation (roomi-fields README; notebooklm-py Android
backend docs).

### Route A: Claude in Chrome driving the logged-in account

- **Method.** Claude Code's `--chrome` / Claude in Chrome extension "shares your browser's
  login state". It clicks and types in a visible window, uploads local files, reads the DOM and
  saves screenshots. It "pauses and asks you" at login pages and CAPTCHAs
  ([Claude Code: Chrome](https://code.claude.com/docs/en/chrome)).
- **Hard limits that matter here.**
  - Each upload is capped at **10 MB of files in total**. Lecture PDFs above that must go
    through Google Drive and be added as a Drive source.
  - The extension's service worker can idle out during long sessions, and "Receiving end does
    not exist" means a reconnect.
  - JS modal dialogs block it.
  - Windows has named-pipe and native-host quirks.
  - It needs a direct Anthropic plan and `/login` (not an API key).
- **Safety.** Every visible tab is screenshotted into the conversation. Anthropic recommends a
  separate browser profile and "Manually approve" for sensitive work
  ([Use Claude in Chrome safely](https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely)).
- **Reliability: medium.** It adapts to UI changes because it reads the page, not fixed
  selectors. But a long Video generation (>30 min) means polling, and each step is a model call.
- **Speed: slow.** Seconds per action, on top of Google's own generation time.
- **ToS/account risk: lowest of the automated routes.** It is a real browser with a
  human-attended session at normal pace, but it is still "automated means".
- **Maintenance: low.** There's no code to fix when Google changes the UI, though prompts or
  recipes may need tweaks.
- **CLAUDE.md fit.** This matches the standing constraint ("driven through browser/computer
  automation on Seif's account").

### Route B: desktop computer use

- On Windows it exists only in the **Claude Desktop app** (research preview, Pro/Max). The CLI
  version is macOS-only
  ([Claude Code: computer use](https://code.claude.com/docs/en/computer-use)).
- **Browsers are capped at "view only"**: Claude can see them in screenshots but can't click
  or type ([Claude Code Desktop: app permissions](https://code.claude.com/docs/en/desktop)).
  NotebookLM has no Windows desktop app, so **computer use can't drive NotebookLM**. The docs
  send browser work to Claude in Chrome instead. Whether an installed Chrome PWA counts as a
  "browser" is undocumented (**unverified**).
- **Verdict.** Not a viable primary route. At most it can watch a screen.

### Route C: unofficial libraries, CLIs and MCP servers

All of these use **undocumented internal endpoints** (the web app's `batchexecute` RPCs, or the
Android app's gRPC). A few drive a real browser instead. Stars and last push are from the GitHub
API on 2026-09-25.

| Project | Stars | Last push | Method | Auth | Outputs | Notes |
|---|---|---|---|---|---|---|
| [teng-lin/notebooklm-py](https://github.com/teng-lin/notebooklm-py) (Python lib + CLI + MCP + REST + Claude skill) | 19,466 | 2026-09-25 | Web `batchexecute` RPC (default); opt-in Android gRPC backend | Playwright login → cookies; or import cookies from a browser; or a durable **master token** (full-account credential) | Every Studio type. Downloads: MP3, MP4, PDF/PPTX, PNG, quiz/flashcards as JSON/MD/HTML, mind map JSON, data table CSV, report MD. | MIT. Very active: v0.8.2 on 2026-09-02, 13 pre-releases in July. Automated "RPC drift" and "auth failure" health-check issues are opened and closed routinely (e.g. [#2018](https://github.com/teng-lin/notebooklm-py/issues/2018), [#2175](https://github.com/teng-lin/notebooklm-py/issues/2175), [#2323](https://github.com/teng-lin/notebooklm-py/issues/2323)). |
| [jacob-bd/gemini-notebook-mcp-cli](https://github.com/jacob-bd/gemini-notebook-mcp-cli) (`nlm` CLI + MCP, PyPI `notebooklm-mcp-cli`) | 6,160 | 2026-09-24 | Internal RPC | Launches a dedicated browser profile via CDP (or Firefox) and extracts cookies | Studio create/revise, download one or all artifacts, public share, `nlm usage` quota check. 50 MCP tools. | MIT. Releases every few days (v0.12.0 on 2026-09-24, two "security releases" in Sept). Enterprise support is experimental. Old `jacob-bd/notebooklm-cli` is archived. |
| [tmc/nlm](https://github.com/tmc/nlm) (Go binary CLI + MCP) | 391 | 2026-09-23 | Reverse-engineered protobuf wire protocol | Browser sign-in, session saved | Audio, video, decks, reports, flashcard export. **No mind-map export yet.** | MIT. Single static binary. |
| [roomi-fields/notebooklm-mcp](https://github.com/roomi-fields/notebooklm-mcp) (MCP + 33-endpoint REST) | 182 | 2026-09-04 | `batchexecute` RPC with automatic **Playwright browser fallback** | Multi-account rotation, auto re-auth | Full Studio | MIT. Recommends a dedicated account. Fixed a wrong-language bug in 3.1.x. |
| [icebear0828/notebooklm-client](https://github.com/icebear0828/notebooklm-client) | 228 | 2026-05-27 | Boq RPC, browser or pure HTTP | Cookies | Audio-focused | Quieter (last push May). |
| [PleasePrompto/notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) / [-skill](https://github.com/PleasePrompto/notebooklm-skill) | 3,431 / 7,779 | 2026-09-10 | Real Chrome via Patchright (stealth fingerprint) | Persistent Chrome profile | Chat, sources, audio | **Archived in Sept 2026**: "no longer maintained… may stop working". A cautionary example of how long these last. |
| Others: [khengyun](https://github.com/khengyun/notebooklm-mcp) (83★, Jun), [Pantheon-Security](https://github.com/Pantheon-Security/notebooklm-mcp-secure) (84★, Sep) | small | — | mixed | — | — | Low adoption |

**Route C assessment**

- **Reliability: medium-high while maintained.** The top two libraries fix breakage within days.
  notebooklm-py ran an RPC-drift detector through the July rebrand
  ([#2077](https://github.com/teng-lin/notebooklm-py/issues/2077),
  [#2078](https://github.com/teng-lin/notebooklm-py/issues/2078)). But every Google-side change
  is an outage until the maintainer ships, and projects do get abandoned (PleasePrompto).
- **Speed: fastest.** It's direct HTTP, and roomi-fields reports RPC at "10-100× faster than
  scraping". Google-side generation time still dominates, and video can take 30+ min.
- **ToS/account risk: highest.** Hitting private RPCs from non-browser clients is the closest
  fit to the ToS "reverse engineering"/"bypassing" language. The **master-token** mode stores a
  "powerful full-account credential" (notebooklm-py README). The maintainers themselves say to
  use a dedicated account.
- **Maintenance: medium.** You pin a version and upgrade when it breaks. The glue code on our
  side is small.
- **Windows-specific auth friction** (relevant: the owner is on Windows 11):
  - Chrome 127+ **App-Bound Encryption** blocks all cookie extraction from Chrome/Edge.
  - Playwright logins can miss the `__Secure-1PSIDTS` cookie.
  - The documented fix is signing in through **Firefox** as the cookie source
    ([notebooklm-py troubleshooting](https://github.com/teng-lin/notebooklm-py/blob/main/docs/troubleshooting.md)).
- **Secrets.** Cookie jars and master tokens are credentials. The global `CLAUDE.md` "never
  expose secrets" rule applies, so they must never be committed.

### Route summary

| Route | Reliability | Speed | ToS / account risk | Maintenance | Covers all outputs? |
|---|---|---|---|---|---|
| A. Claude in Chrome | Medium (adapts to UI; long waits; reconnects) | Slow | Low-medium | Low | Yes (anything in the UI) |
| B. Desktop computer use | n/a (browsers are view-only) | — | — | — | No |
| C. Unofficial RPC libs (notebooklm-py, nlm) | Medium-high while maintained | Fast | Highest (private RPCs; tokens) | Medium (version pins, breakage) | Yes, plus exports the UI lacks (quiz JSON, mind-map JSON) |
| C′. Browser-driving MCPs (Patchright/Playwright) | Medium (selector drift) | Medium | Medium (stealth fingerprinting) | Medium-high | Partial |
| D. Enterprise API | High (official, but Pre-GA) | Fast | None | Low | **No**: notebooks, sources and audio only; needs a Cloud licence |
| Manual (Seif clicks, agent ingests files) | High | Human-paced | None | None | Yes |

## 6. Implications for learn-premium (options, no choice made)

1. **Chrome-driven, human-attended.** The agent runs NotebookLM through Claude in Chrome on
   Seif's (or a dedicated) account, downloads the MP4/MP3/PNG/PDF, and the build embeds the files.
   - For: matches the current `CLAUDE.md` constraint, lowest account risk, no third-party code.
   - Against: slow; the 10 MB upload cap pushes PDFs through Drive; someone must be present for
     logins/CAPTCHAs; long video waits.
2. **Library-driven (notebooklm-py or `nlm`)** on a **dedicated** Google account with its own
   AI Pro subscription.
   - For: scriptable, batchable, structured exports (quiz/flashcard JSON, mind-map JSON) that
     slot straight into Study-site engines.
   - Against: highest ToS exposure, credential handling on Windows (Firefox cookie route), and
     outages when Google changes RPCs.
3. **Hybrid.** Use a library for read-mostly, structured pulls (quiz/flashcard/mind-map JSON,
   reports), and Chrome or a human for the media generations that are few per course.
   - For: fewer risky calls, best data shapes.
   - Against: two paths to maintain.
4. **Manual hand-off.** The skill writes a precise "NotebookLM recipe" (sources, prompts,
   styles, language) and Seif clicks Generate. The skill then ingests the downloaded files from
   a folder.
   - For: zero risk, zero maintenance, and it survives any Google change.
   - Against: human time per course; not autonomous.
5. **Treat NotebookLM as optional enrichment, not a pipeline dependency.**
   - For: the Study site never blocks on a Google outage, quota or ban.
   - Against: less media by default.

Cross-cutting facts any option must respect:

- **Quotas.** On AI Pro: 20 video and 20 audio a day, and numbers for slides and infographics
  aren't published.
- **Language and age gates.** Cinematic is English-only; Arabic output needs verification;
  several features need 18+.
- **Public artifact links.** They only work on consumer accounts and expose the notebook's
  sources to viewers, which matters because professors' materials must stay unpublished.
  Self-hosting downloaded files avoids this.
- **Accuracy.** Google's own disclaimers mean NotebookLM output still needs v1's accuracy gate.

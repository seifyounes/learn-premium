# Deploying the Fixture Course

The Fixture Course deploys to its own Vercel project through Vercel's Git integration: `main` is
the live site, and every other branch gets a preview. Vercel builds the Site template
(`template/vercel.json`) as plain static files. A production build has no Trap page.

## What guards a deploy

1. **Before merge** (template CI, `.github/workflows/template-ci.yml`): the deploy gates run on a
   production build of the Fixture Course. They block when the build holds a Materials file or
   anything from Build evidence, when a page or `vercel.json` drops noindex, or when the Licences
   file is missing a hand-written notice, is linked from a page, or differs from the committed
   `template/public/licences.txt`. The licence gate raises a Checkpoint item for any shipped
   package off the allow-list. The live gates then run on the same build, served the way Vercel
   serves it under `vercel.json`.
2. **After the deploy** (`.github/workflows/fixture-live.yml`, on Vercel's GitHub deployment
   event): the run waits until production serves the deployed commit. Then the live gates check
   the live URL:
   - every route answers 200 with the build's own page, the hubs are there, and so is
     `/licences.txt`;
   - every response carries `X-Robots-Tag: noindex`;
   - pages, scripts and stylesheets come Brotli-compressed;
   - Materials and evidence paths answer 404.

   Green marks the commit with the `learn-premium/live-gates` status. Red rolls Vercel back to the
   newest earlier production deployment whose commit carries a green status, and opens an issue
   assigned to the Owner. The issue says the rollback is done only once production actually
   serves the target. A run whose deployment a newer one has already replaced in production
   settles nothing: the newer deployment's own run checks the site. The performance report (initial JS against the ~300 KB reference, LCP,
   Lighthouse mobile) goes in the run's summary and never blocks.

The project is on Vercel's **Hobby** plan, where Instant Rollback only goes back to the deployment
just before the current one. When the last green deployment is further back, Vercel refuses and
the issue says so; production then stays on the failing deployment until the Owner promotes the
green one by hand or fixes forward. After any rollback, Vercel stops promoting new pushes to
`main` until it is undone. To undo it, use **Undo Rollback** on the project's production tile or
`vercel promote <deployment>`. Until then, every push's run ends in a "never went live" issue that
says so.

Once production serves the deployed commit, the verdict always runs. Gates that couldn't run,
such as after a failed build in the run, count as failed and roll production back. If production
never serves the commit, nothing is rolled back and the issue says why.

## Setting up the Vercel project (the Owner, once)

1. In Vercel, **Add New → Project** and import `seifyounes/learn-premium` (give Vercel's GitHub
   app access to the repo if it asks).
2. Set **Root Directory** to `template`, and keep "Include files outside the root directory in
   the Build Step" on: the build reads `../fixture-course`. `vercel.json` sets the framework, the
   install and build commands, the output folder and the noindex header, so leave those as they
   come.
3. Deploy. The production branch is `main`.
4. Give GitHub what the live run needs:

   ```bash
   gh variable set FIXTURE_LIVE_URL --repo seifyounes/learn-premium --body "https://<project>.vercel.app"
   ```

   ```bash
   gh variable set VERCEL_PROJECT_ID --repo seifyounes/learn-premium --body "prj_…"
   ```

   ```bash
   gh secret set VERCEL_TOKEN --repo seifyounes/learn-premium
   ```

   The project ID is under Project Settings → General. Create the token under Account Settings →
   Tokens. A team-owned project also needs `VERCEL_TEAM_ID`; a personal Hobby account needs none.

5. Prove it: the next push to `main` should end with a green **Fixture live gates** run. After a
   second green deploy (on Hobby, the rollback target must be the deployment just before the
   current one, and it must be green), run the drill once: Actions → Fixture live gates → Run
   workflow on `main` → `drill`. Production should roll back to the previous green deployment and
   an issue should open. The drill doesn't mark the current commit red, so undo the rollback
   afterwards and production is back where it was.

## Release sequence

CI green → the Fixture Course deploys and its live gates go green → the Owner's real-phone pass on
the Tool gallery (`/tool-gallery/`, linked from no page) → tag.

The commands that enforce it, and the release notes and migration harness that go with it: `docs/release.md`.

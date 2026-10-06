# Cutting a Template release

A Template release is one semver tag, `vX.Y.Z`, over the skill, the Site template and its gates
together. The Machine install moves to it, and an Upgrade wave carries a Course project to it.

- **major**: the content contract changes (`template/src/content/contract.ts`). It ships
  `template/migrations/v<major>.ts`.
- **minor**: new gates, components or sim kinds.
- **patch**: fixes.

A release is cut only on a commit of `main`, and only through `skill/scripts/release.ts`. It
refuses to tag until every step below holds on that exact commit.

## The sequence

1. **CI green.** The newest run of each of these workflows on the commit succeeded: Template CI,
   Skill CI and the Migration harness. A workflow only runs on a push that touches its paths, so
   `status` prints the `gh workflow run … --ref main` command for any that have no run on the
   commit.
2. **The Tool gallery deployed, live gates green.** Vercel deployed the commit and the Fixture
   live gates passed on it (the `learn-premium/live-gates` status, `docs/deploy.md`). `status`
   prints the commit's own Tool gallery URL: its Production deployment's URL, which serves only that
   build, or the production URL when GitHub has no deployment for the commit.
3. **The Owner's real-phone pass.** The Owner opens that Tool gallery on a real phone. They use
   every sim by touch, orbit and zoom the 3D viewer, and time the Pyodide run from its "Run live"
   tap to its plot. Then, in their own terminal, they record the pass on the commit:

   ```bash
   node skill/scripts/release.ts record-phone-pass --sha <sha> --devices "iPhone 13 Safari, Pixel 7 Chrome" --pyodide-seconds 14
   ```

   It refuses before steps 1 and 2 are green, refuses any GitHub account but the repo owner's, and
   asks the Owner to type `yes`. With no terminal attached (a script, CI, an agent's shell) the
   answer is no, so nothing else can record a pass. The pass is a `learn-premium/real-phone-pass`
   commit status naming the phones and the Pyodide time. It counts only on the commit it was
   recorded on, and only when the repo owner set it.
4. **Tag.**

   ```bash
   node skill/scripts/release.ts tag --bump minor
   ```

   It checks steps 1 to 3 again, then picks the version: one bump past origin's latest release
   tag. Before the first release that is from v0.0.0, so `--bump minor` cuts v0.1.0. `--version
   vX.Y.Z` names one outright. It refuses:

   - a version that isn't newer than the latest release, or a tag origin already has;
   - a commit that isn't on top of the latest release;
   - a major that doesn't ship the migration for each major it crosses;
   - a non-major that ships a migration.

   Then it writes the release notes, pushes an annotated tag carrying them to origin, and
   publishes the GitHub Release. `--dry-run` does every check and prints the notes, but tags
   nothing.

`status` walks the same checklist without changing anything. Run it first:

```bash
node skill/scripts/release.ts status --bump minor
```

Every command reads origin, never the local clone, and defaults to origin's `main` tip. `--sha`
names an earlier commit of `main`.

## Release notes

`node skill/scripts/release.ts notes --bump minor [--out notes.md]` prints the draft. The notes
have these sections:

- **Gate gaps closed**: each closed `gate-gap` issue (closed as completed) that a commit since the
  previous release names as `#N`. That is the `(ticket #N)` every commit carries.
- **Course overrides retired**: for each of those gate gaps, the overrides its issue names. The
  Upgrade wave drops each Course's overrides tied to these gate gaps.
- **Migrations**: what a major's migrations change.
- **Real-phone pass**: the phones, the Pyodide time, and when the Owner recorded it.

A gate gap that is closed but named by no commit isn't listed. `notes` and `tag` print a
`check:` line for it, so the Owner can confirm it before tagging. To change the wording, edit the
draft and pass it to `tag --notes notes.md`. The tag refuses a notes file that has lost either of
the first two sections. `parseNotes` in `skill/scripts/release/notes.ts` reads the notes back for
the Upgrade wave's offer.

A `gate-gap` issue names its Course and overrides on lines of their own, which the notes read:

```text
Course: Machine Learning
Course override: `src/components/Beat.astro`
```

## The migration harness

A major ships `template/migrations/v<major>.ts`. It exports `describe` (one line, used in the
notes) and `migrate(contentDir)`, which rewrites a Course's content and course config in place.
`npm run migrations -- run --content <dir> --from <release>` (from `template/`) runs every
shipped migration newer than the content's release, oldest first. An upgrade from v1.2 to v3.0
runs v2, then v3. From v1.2 to v1.5 it runs none. The Upgrade wave runs it on its branch.

The Migration harness workflow (`.github/workflows/migration-harness.yml`, `npm run migrations --
prove`) takes the Fixture Course from the latest release tag behind the commit. It runs the
migrations on a copy, then checks the copy against this template's content contract and builds
it. Within one major no migration runs, so the previous release's Fixture Course must pass as it
is. A contract change that breaks it needs a major release and its migration. Before the first
release there's nothing to upgrade, so the harness is green.

## The first release (v0.x)

The first tag goes through the same sequence. Fix whatever `status` reports, have the Owner do the
phone pass, then `tag --bump minor` cuts v0.1.0.

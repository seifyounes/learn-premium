# Module media ship in git; Professor-derived evidence stays beside the Materials

Module media (re-encoded MP4, MP3, PNG), GLB parts, ngspice grids and Pyodide are committed in
the Course project and served by Vercel as static files, against Vercel's own advice to put large
video in Blob or a video host. Vercel Blob's free 1 GB is shared by every Course, Git LFS's free
10 GiB/month bandwidth is spent by Vercel pulling the LFS files on every build, and Cloudflare
R2 (10 GB free, no egress) needs a domain on Cloudflare the Owner doesn't have. Separately, a
Course project may one day go public on the Owner's CV, so it holds only what the Study site
publishes plus build records free of the Professor's text. Transcriptions, quotes and crops
of the Materials live in a Private folder beside the Materials, outside any repo (ticket #31).

## Consequences

- Media are re-encoded to a web profile (H.264 720p faststart, 64 kbps mono speech) and only
  checked media is committed, so rejected outputs never enter git history. Sizes are reported,
  not capped; a file over GitHub's 100 MB block is re-encoded harder once, else dropped.
- Vercel doesn't cache range (seek) requests, which may eat Hobby's 10 GB/month origin transfer.
  The Owner reads Vercel usage in the Pilot course's first month live; past half an allowance,
  a new ticket reopens the media store, with R2 plus a bought domain as the known next step.
- A pre-commit gate blocks any file whose hash matches the Materials inventory, and any file in
  an evidence-shaped path, with a planted Materials file as its negative control.
- A relaunched agent reviews its predecessor from the Private folder and the Materials, by path.

## Amendment: Pyodide's core comes from the template (2026-10-05, ticket #50)

"Pyodide committed in the Course project" now covers only the package files a Course's Pyodide
tools load (numpy, scikit-learn…): they sit in the Course's `pyodide/` folder, committed, and are
checked against the SHA-256 in Pyodide's lock at every build. Pyodide's core (the loader, the
runtime wasm, the standard library and the lock, about 13.5 MB) is not committed per Course. It
comes from the `pyodide` npm package the Site template pins exactly, and the build copies it into
the site. Either way the Study site serves all of Pyodide itself, from its own `/pyodide/`, and
never asks a CDN. The Owner ruled this on ticket #50.

- The core's version moves only with a Template release, which pins it in the lockfile; the
  package files a Course commits must match that version's lock, or the build fails.
- A Course with no Pyodide tool commits and ships no Pyodide.
- The Run-live button counts uncompressed bytes, an upper bound on what the phone downloads if
  Vercel compresses the files (the Owner's ruling on #50); the Tool gallery's timing run shows the
  bytes actually fetched.

# Study sites are online-only, one Vercel project per Course

v1 shipped each Study site as one offline HTML file (plus a Vercel copy), which kept it usable
without internet but made video, 3D parts and circuit simulators impractical to carry. v2 drops
the offline single file: a Study site is a hosted Vercel site, online only, with a light shell
and heavy tools loaded on demand, one project and URL per Course. The Owner always hosts on
Vercel anyway, and the richer media v2 exists for outweighs offline use.

## Consequences

- v1's "link-outs only, never iframes" video rule (kept for offline safety) no longer binds;
  embedding is now an experience decision.
- Progress stays per-browser (`localStorage`-style); no accounts, no cross-device sync.
- Every Study site URL is public-by-link, so the "raw Materials must 404" check becomes a deploy
  gate.

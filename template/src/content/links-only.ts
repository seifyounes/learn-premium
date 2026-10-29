// The sites whose pages appear on a study site only as credited plain links, in a new tab: never
// iframed, embedded, loaded as a script or copied onto the site (the `links-only` gate holds the
// built pages to it). Each asks to be credited as the credit below says.

export const LINK_ONLY_HOSTS = [
  {
    host: "phet.colorado.edu",
    /** How the page is named in a message. */
    site: "PhET",
    credit: "PhET Interactive Simulations, University of Colorado Boulder",
  },
  { host: "falstad.com", site: "Falstad", credit: "Paul Falstad" },
] as const;

/** The link-only site a URL is on (the host or any of its subdomains), or undefined. */
export function linkOnlyHost(url: string): (typeof LINK_ONLY_HOSTS)[number] | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return LINK_ONLY_HOSTS.find((h) => host === h.host || host.endsWith(`.${h.host}`));
}

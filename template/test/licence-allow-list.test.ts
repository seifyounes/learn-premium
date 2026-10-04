import { describe, expect, it } from "vitest";
import { ALLOWED_LICENCES, licenceVerdict } from "../src/licences/spdx.ts";

describe("the licence allow-list", () => {
  it("allows exactly the twelve licences the spec names", () => {
    expect([...ALLOWED_LICENCES].sort()).toEqual(
      [
        "MIT",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "ISC",
        "Apache-2.0",
        "0BSD",
        "CC0-1.0",
        "Zlib",
        "BSL-1.0",
        "PSF-2.0",
        "OFL-1.1",
        "MPL-2.0",
        "EPL-2.0",
      ].sort(),
    );
  });

  it.each(["MIT", "Apache-2.0", "OFL-1.1", "MPL-2.0", "EPL-2.0", "0BSD", "BSL-1.0", "PSF-2.0"])("allows %s", (id) => {
    expect(licenceVerdict(id)).toEqual({ allowed: true });
  });

  it("allows a choice when any side is allowed, and a conjunction only when every side is", () => {
    expect(licenceVerdict("(MIT OR LGPL-3.0-or-later)").allowed).toBe(true);
    expect(licenceVerdict("MIT AND Zlib").allowed).toBe(true);
    expect(licenceVerdict("Apache-2.0 AND LGPL-3.0-or-later").allowed).toBe(false);
    expect(licenceVerdict("(MIT AND ISC) OR GPL-3.0-only").allowed).toBe(true);
  });

  it("sends GPL, non-commercial, no-derivatives and unknown licences to the Owner, saying why", () => {
    expect(licenceVerdict("GPL-3.0")).toEqual({ allowed: false, reason: "GPL-3.0 is not on the allow-list" });
    expect(licenceVerdict("CC-BY-NC-4.0").allowed).toBe(false);
    expect(licenceVerdict("CC-BY-ND-4.0").allowed).toBe(false);
    expect(licenceVerdict(undefined)).toEqual({ allowed: false, reason: "the package declares no licence" });
    expect(licenceVerdict("SEE LICENSE IN LICENSE.txt")).toEqual({
      allowed: false,
      reason: 'the licence "SEE LICENSE IN LICENSE.txt" is not an SPDX expression the gate can read',
    });
    expect(licenceVerdict("MIT WITH Classpath-exception-2.0").allowed).toBe(false);
  });
});

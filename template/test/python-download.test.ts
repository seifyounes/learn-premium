// What a Run-live tap downloads: Pyodide's core files and every package a tool names, with the
// packages they depend on, resolved through Pyodide's lock file; and how the button prints it.
import { describe, expect, it } from "vitest";
import { CORE_FILES, packageFiles, sizeLabel, type Lock } from "../src/python/lock.ts";

const pkg = (name: string, depends: string[] = [], imports = [name]) => ({
  name,
  version: "1.0",
  file_name: `${name}-1.0-py3-none-any.whl`,
  install_dir: "site",
  sha256: `${name}-hash`,
  package_type: "package",
  imports,
  depends,
});

const lock: Lock = {
  info: { arch: "wasm32", platform: "emscripten", version: "0", python: "3.14" },
  packages: {
    numpy: pkg("numpy"),
    scipy: pkg("scipy", ["numpy", "openblas"]),
    openblas: pkg("openblas"),
    "scikit-learn": pkg("scikit-learn", ["scipy", "joblib"], ["sklearn"]),
    joblib: pkg("joblib"),
  },
} as unknown as Lock;

describe("packageFiles", () => {
  it("is nothing for a tool that imports only the standard library", () => {
    expect(packageFiles(lock, [])).toEqual([]);
  });

  it("brings each package's dependencies, each once, dependencies first", () => {
    expect(packageFiles(lock, ["scikit-learn", "numpy"]).map((p) => p.name)).toEqual([
      "numpy",
      "openblas",
      "scipy",
      "joblib",
      "scikit-learn",
    ]);
  });

  it("names each package's file and hash from the lock", () => {
    expect(packageFiles(lock, ["numpy"])).toEqual([
      { name: "numpy", file: "numpy-1.0-py3-none-any.whl", sha256: "numpy-hash" },
    ]);
  });

  it("refuses a package Pyodide doesn't ship, pointing an import name at its package", () => {
    expect(() => packageFiles(lock, ["sklearn"])).toThrow(/"sklearn" isn't a Pyodide package.*scikit-learn/);
    expect(() => packageFiles(lock, ["tensorflow"])).toThrow(/"tensorflow" isn't a Pyodide package/);
  });
});

describe("sizeLabel", () => {
  it("prints megabytes to one place, rounded up so it never understates", () => {
    expect(sizeLabel(15_200_000)).toBe("15.2 MB");
    expect(sizeLabel(15_200_001)).toBe("15.3 MB");
    expect(sizeLabel(9_000_000)).toBe("9.0 MB");
    expect(sizeLabel(1)).toBe("0.1 MB");
  });
});

it("has the core files every Pyodide start fetches", () => {
  expect(CORE_FILES).toEqual([
    "pyodide.mjs",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ]);
});

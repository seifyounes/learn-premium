"""The independent recompute for the Fixture Course's midterm sitting: every numeric question of the
2025 past paper and of the mocks, worked in exact fractions from the question as the (synthetic)
Materials state it, written apart from the content files and never reading them. A plane layer's
thermal resistance is R = L / (k A); a question that gives R and asks for the thickness is
L = R k A. It writes one recompute log per paper, by question number, which the past-papers and
mock-dna gates compare the content's answers with.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-midterm.py
"""

import json
from fractions import Fraction
from pathlib import Path

LOGS = Path(__file__).resolve().parents[1] / "build-records" / "recompute" / "sittings" / "midterm"

BY = "fixture-course/tools/recompute-midterm.py: R = L/(kA) and L = RkA, exact fractions, apart from the content"


def resistance(length: str, k: str, area: str) -> Fraction:
    return Fraction(length) / (Fraction(k) * Fraction(area))


def thickness(r: str, k: str, area: str) -> Fraction:
    return Fraction(r) * Fraction(k) * Fraction(area)


# Question number -> its numeric answer. The announced mock is all prose: nothing to recompute.
PAPERS: dict[str, dict[str, Fraction]] = {
    "2025": {"1": resistance("0.25", "1.0", "1"), "2": thickness("0.1", "0.5", "2")},
    "mock-1": {"1": resistance("0.30", "0.6", "1"), "2": thickness("0.25", "0.4", "2")},
    "announced": {},
}


def main() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    for name, answers in PAPERS.items():
        log = {
            "recompute": "learn-premium paper recompute v1",
            "by": BY,
            "answers": {n: float(value) for n, value in answers.items()},
        }
        path = LOGS / f"{name}.json"
        path.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()

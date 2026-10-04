"""The independent recompute for the Fixture Course's full-adder sim: the circuit as the
(synthetic) Materials draw it, every net worked out for every row of inputs by walking back from
the net to the gate that drives it. Written apart from the Site template's logic engine and never
reading it or the sim file. It writes the recompute log the truth-table gate compares the engine
and the sheet with.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-full-adder.py
"""

import json
from functools import cache
from itertools import product
from pathlib import Path

LOG = Path(__file__).resolve().parents[1] / "build-records" / "recompute" / "04-full-adder" / "adder.json"

# The circuit, as the synthetic figure draws it: two half adders and an OR for the carry.
PARTS = [
    {"id": "A", "kind": "port", "label": "A"},
    {"id": "B", "kind": "port", "label": "B"},
    {"id": "Cin", "kind": "port", "label": "Cin"},
    {"id": "G1", "kind": "xor", "label": "G1"},
    {"id": "G2", "kind": "and", "label": "G2"},
    {"id": "G3", "kind": "xor", "label": "G3"},
    {"id": "G4", "kind": "and", "label": "G4"},
    {"id": "G5", "kind": "or", "label": "G5"},
    {"id": "S", "kind": "port", "label": "S"},
    {"id": "Cout", "kind": "port", "label": "Cout"},
]
NETS = [
    {"id": "A", "pins": ["A.t", "G1.in1", "G2.in1"]},
    {"id": "B", "pins": ["B.t", "G1.in2", "G2.in2"]},
    {"id": "Cin", "pins": ["Cin.t", "G3.in2", "G4.in2"]},
    {"id": "AxB", "pins": ["G1.out", "G3.in1", "G4.in1"]},
    {"id": "AB", "pins": ["G2.out", "G5.in2"]},
    {"id": "CinAxB", "pins": ["G4.out", "G5.in1"]},
    {"id": "S", "pins": ["G3.out", "S.t"]},
    {"id": "Cout", "pins": ["G5.out", "Cout.t"]},
]
INPUTS = ["A", "B", "Cin"]
OUTPUTS = ["S", "Cout"]
# The row the example reads off: A = 1, B = 0, Cin = 1.
START = {"A": 1, "B": 0, "Cin": 1}

GATE = {
    "and": lambda a, b: a & b,
    "or": lambda a, b: a | b,
    "xor": lambda a, b: a ^ b,
}


def table() -> dict[str, int]:
    kind = {p["id"]: p["kind"] for p in PARTS}
    net_of = {pin: net["id"] for net in NETS for pin in net["pins"]}
    values: dict[str, int] = {}
    for bits in product((0, 1), repeat=len(INPUTS)):
        row = "".join(map(str, bits))
        given = dict(zip(INPUTS, bits))

        @cache
        def level(net: str) -> int:
            pins = next(n["pins"] for n in NETS if n["id"] == net)
            for pin in pins:
                part, name = pin.split(".")
                if part in given:
                    return given[part]
                if name == "out":
                    return GATE[kind[part]](level(net_of[f"{part}.in1"]), level(net_of[f"{part}.in2"]))
            raise ValueError(f"nothing drives net {net}")

        for net in NETS:
            values[f"{net['id']}[{row}]"] = level(net["id"])
    return values


def main() -> None:
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-full-adder.py: each net walked back to its driving gate, apart from the engine",
        "inputs": {
            "model": {"parts": PARTS, "nets": NETS, "inputs": INPUTS, "outputs": OUTPUTS},
            "start": START,
        },
        "values": table(),
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()

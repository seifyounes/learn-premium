"""The independent recompute for the Fixture Course's Module 14 state machines: the '101' detector
(a Moore machine) worked from the figure's hand-read lookup table, and the drill's GRAFCET worked from
IEC 60848's firing rules. Written apart from the Site template's state-machine engine, and never
reading it: it parses no edge label and no receptivity (the figure's tables are typed here by hand),
and it reads each sim file only to copy the `model` and `start` it was worked from into the log's
`inputs`, exiting if the file's input sequence is not the one it worked. It writes the recompute log
the `state-table` and `timing-key` gates compare the engine and the key with: the timing strip's bits
(`row[k]`) and the whole table, every reachable situation under every combination of the inputs.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-state-machines.py
"""

import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "modules" / "14-state-machines" / "sims"
RECORDS = ROOT / "build-records" / "recompute" / "14-state-machines"
BY_DETECTOR = (
    "fixture-course/tools/recompute-state-machines.py: the detector by a hand-read lookup table, "
    "apart from the engine"
)
BY_DRILL = (
    "fixture-course/tools/recompute-state-machines.py: the drill by IEC 60848's firing rules, "
    "apart from the engine"
)

# ---- the '101' detector, read from the figure: (present state, x) -> next state, and the output
# each state sets (S3, the double circle, is the only one), and each state's code on Q1 Q0.
NEXT = {
    ("S0", 0): "S0", ("S0", 1): "S1",
    ("S1", 0): "S2", ("S1", 1): "S1",
    ("S2", 0): "S0", ("S2", 1): "S3",
    ("S3", 0): "S2", ("S3", 1): "S1",
}
Z = {"S0": 0, "S1": 0, "S2": 0, "S3": 1}
CODES = {"S0": (0, 0), "S1": (0, 1), "S2": (1, 0), "S3": (1, 1)}
X = "011010100"
DETECTOR_ORDER = ["S0", "S1", "S2", "S3"]


def detector():
    values = {}
    state = "S0"
    for k, bit in enumerate(X, start=1):
        x = int(bit)
        values[f"x[{k}]"] = x
        values[f"Q1[{k}]"], values[f"Q0[{k}]"] = CODES[state]
        values[f"z[{k}]"] = Z[state]
        state = NEXT[(state, x)]
    table = []
    seen, queue = {"S0"}, ["S0"]
    for here in queue:
        for x in (0, 1):
            there = NEXT[(here, x)]
            table.append({"from": [here], "inputs": {"x": x}, "to": [there], "outputs": {"z": Z[here]}})
            if there not in seen:
                seen.add(there)
                queue.append(there)
    return values, table


# ---- the drill's GRAFCET, read from the figure: steps, the initial step, each transition with its
# receptivity (a function of m, a, b), and the action each step holds.
STEPS = ["X0", "X1", "X2"]
INITIAL = {"X0"}
TRANSITIONS = [
    ("X0", "X1", lambda m, a, b: m and a),
    ("X1", "X2", lambda m, a, b: b),
    ("X2", "X0", lambda m, a, b: a),
]
ACTIONS = {"X1": "KM1", "X2": "KM2"}
OUTPUTS = ["KM1", "KM2"]
INPUTS = ["m", "a", "b"]
STIMULUS = {"m": "010000000", "a": "111000011", "b": "000011000"}


def clock(situation, m, a, b):
    """One evolution (IEC 60848 rules 3 and 4): every transition whose step is active and whose
    receptivity is true fires at once; the steps before them are deactivated, then the steps after
    them are activated (so a step both left and entered stays active)."""
    firing = [t for t in TRANSITIONS if t[0] in situation and t[2](m, a, b)]
    left = {src for src, _, _ in firing}
    entered = {dst for _, dst, _ in firing}
    return frozenset((set(situation) - left) | entered)


def actions(situation):
    return {out: int(any(ACTIONS.get(step) == out for step in situation)) for out in OUTPUTS}


def in_model_order(situation):
    return [step for step in STEPS if step in situation]


def drill():
    values = {}
    situation = frozenset(INITIAL)
    for k in range(1, len(STIMULUS["m"]) + 1):
        m, a, b = (int(STIMULUS[name][k - 1]) for name in INPUTS)
        values[f"m[{k}]"], values[f"a[{k}]"], values[f"b[{k}]"] = m, a, b
        for step in STEPS:
            values[f"{step}[{k}]"] = int(step in situation)
        for out, level in actions(situation).items():
            values[f"{out}[{k}]"] = level
        situation = clock(situation, m, a, b)
    table = []
    seen, queue = {frozenset(INITIAL)}, [frozenset(INITIAL)]
    for here in queue:
        for m, a, b in itertools.product((0, 1), repeat=len(INPUTS)):
            there = clock(here, m, a, b)
            table.append(
                {
                    "from": in_model_order(here),
                    "inputs": {"m": m, "a": a, "b": b},
                    "to": in_model_order(there),
                    "outputs": actions(here),
                }
            )
            if there not in seen:
                seen.add(there)
                queue.append(there)
    return values, table


def sim_file(name, stimulus):
    """The sim file's model and start, copied verbatim; the recompute stops if it was worked from
    another input sequence."""
    sim = json.loads((MODULE / f"{name}.json").read_text(encoding="utf-8"))
    if sim["model"]["stimulus"] != stimulus:
        sys.exit(f"{name}.json: its stimulus is {sim['model']['stimulus']}, but this recompute worked {stimulus}")
    return {"model": sim["model"], "start": sim["start"]}


def strip(values, rows, periods):
    for row in rows:
        print(f"  {row:>4}: " + " ".join(str(values[f"{row}[{k}]"]) for k in range(1, periods + 1)))


def write(name, by, inputs, values, table):
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": by,
        "inputs": inputs,
        "values": values,
        "table": table,
    }
    RECORDS.mkdir(parents=True, exist_ok=True)
    text = json.dumps(log, indent=2, ensure_ascii=False) + "\n"
    (RECORDS / f"{name}.json").write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    values, table = detector()
    write("detector", BY_DETECTOR, sim_file("detector", {"x": X}), values, table)
    print(f"detector: {len(values)} values, {len(table)} table rows")
    strip(values, ["x", "Q1", "Q0", "z"], len(X))
    values, table = drill()
    write("drill", BY_DRILL, sim_file("drill", STIMULUS), values, table)
    print(f"drill: {len(values)} values, {len(table)} table rows")
    strip(values, ["m", "a", "b", "X0", "X1", "X2", "KM1", "KM2"], len(STIMULUS["m"]))

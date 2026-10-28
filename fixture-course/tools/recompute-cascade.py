"""The independent recompute for the Fixture Course's cascade sim: the circuit as the (synthetic)
Materials draw it, run through its cycle A+ B+ B- A- by walking each line back through the valves to
the supply or an exhaust. Written apart from the Site template's pneumatic engine and never reading
it or the sim file. It writes the recompute log the `pneumatic-cycle` and `timing-key` gates compare
the engine and the key with: the diagram's bits, and the circuit at rest and at every step line.

Its method is deliberately not the engine's. A line's pressure is found by a search outward from one
of its pins through the nets and each valve's open passages (the engine joins every pin at once). The
5/2 valves are re-piloted one at a time, in the order the figure lists them, until a whole pass
changes nothing (the engine re-pilots them all together). A step moves every cylinder that is going
to its end at once (the engine moves time on to the earliest stroke end).

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-cascade.py
"""

import json
from pathlib import Path

LOG = Path(__file__).resolve().parents[1] / "build-records" / "recompute" / "12-cascade" / "cascade.json"

# The circuit, as the synthetic figure draws it: two cylinders, three 5/2 valves (the third is the
# cascade valve), four roller valves, the start button and three air supplies.
PARTS = [
    {"id": "A", "kind": "cylinder", "label": "A", "notes": {"retracted": "a0", "extended": "a1"}, "rest": "retracted"},
    {"id": "B", "kind": "cylinder", "label": "B", "notes": {"retracted": "b0", "extended": "b1"}, "rest": "retracted"},
    {"id": "VA", "kind": "valve-52", "label": "VA", "rest": "12"},
    {"id": "VB", "kind": "valve-52", "label": "VB", "rest": "12"},
    {"id": "CV", "kind": "valve-52", "label": "CV", "rest": "12"},
    {"id": "a0", "kind": "valve-32-roller", "label": "a0"},
    {"id": "a1", "kind": "valve-32-roller", "label": "a1"},
    {"id": "b0", "kind": "valve-32-roller", "label": "b0"},
    {"id": "b1", "kind": "valve-32-roller", "label": "b1"},
    {"id": "S", "kind": "valve-32-button", "label": "S"},
    {"id": "P1", "kind": "air-source"},
    {"id": "P2", "kind": "air-source"},
    {"id": "P3", "kind": "air-source"},
]
NETS = [
    {"id": "P", "pins": ["P1.t", "P2.t", "P3.t", "VA.1", "VB.1", "CV.1"]},
    {"id": "Acap", "pins": ["VA.4", "A.cap"]},
    {"id": "Arod", "pins": ["VA.2", "A.rod"]},
    {"id": "Bcap", "pins": ["VB.4", "B.cap"]},
    {"id": "Brod", "pins": ["VB.2", "B.rod"]},
    {"id": "I", "pins": ["CV.4", "VA.14", "a1.1", "b1.1"]},
    {"id": "II", "pins": ["CV.2", "VB.12", "b0.1", "a0.1"]},
    {"id": "a1out", "pins": ["a1.2", "VB.14"]},
    {"id": "b1out", "pins": ["b1.2", "CV.12"]},
    {"id": "b0out", "pins": ["b0.2", "VA.12"]},
    {"id": "a0out", "pins": ["a0.2", "S.1"]},
    {"id": "Sout", "pins": ["S.2", "CV.14"]},
]
SEQUENCE = ["A+", "B+", "B-", "A-"]
PRESS = ["S"]
SIGNALS = ["I", "II"]
# The button the example presses is let go as it opens.
START = {"S": 0}

KIND = {p["id"]: p["kind"] for p in PARTS}
CYLINDERS = [p["id"] for p in PARTS if p["kind"] == "cylinder"]
FIVE_TWO = [p["id"] for p in PARTS if p["kind"] == "valve-52"]
THREE_TWO = [p["id"] for p in PARTS if p["kind"].startswith("valve-32")]
NET_OF = {pin: net["id"] for net in NETS for pin in net["pins"]}
# Which end each roller valve sits at, from the marks the figure prints on the cylinders.
SITS = {
    label: (p["id"], end)
    for p in PARTS
    if p["kind"] == "cylinder"
    for end, label in p["notes"].items()
}


def passages(part: str, spools: dict, made: dict) -> list[tuple[str, str]]:
    """What a valve joins in its state, as pairs of nodes: pins of this part, `AIR` or `EXH`."""
    kind = KIND[part]
    if kind == "air-source":
        return [(f"{part}.t", "AIR")]
    if kind == "valve-52":
        if spools[part] == "14":
            return [(f"{part}.1", f"{part}.4"), (f"{part}.2", "EXH")]
        return [(f"{part}.1", f"{part}.2"), (f"{part}.4", "EXH")]
    if kind.startswith("valve-32"):
        if made[part]:
            return [(f"{part}.1", f"{part}.2")]
        return [(f"{part}.2", "EXH")]
    return []


def reach(pin: str, spools: dict, made: dict) -> set[str]:
    """Every node a search outward from `pin` reaches: along the nets and through open passages."""
    links: dict[str, set[str]] = {}

    def link(a: str, b: str) -> None:
        links.setdefault(a, set()).add(b)
        links.setdefault(b, set()).add(a)

    for net in NETS:
        for other in net["pins"][1:]:
            link(net["pins"][0], other)
    for part in KIND:
        for a, b in passages(part, spools, made):
            link(a, b)
    seen = {pin}
    frontier = [pin]
    while frontier:
        here = frontier.pop()
        for there in links.get(here, ()):
            if there not in seen:
                seen.add(there)
                frontier.append(there)
    return seen


def pressure(pin: str, spools: dict, made: dict, before: dict) -> int:
    """The line's pressure at `pin`: 1 walking back to the supply, 0 to an exhaust. A line reaching
    neither is trapped air and keeps the level it had; reaching both is a short, which is a bug."""
    found = reach(pin, spools, made)
    if "AIR" in found and "EXH" in found:
        raise ValueError(f"supply and exhaust meet through {sorted(found - {'AIR', 'EXH'})}")
    if "AIR" in found:
        return 1
    if "EXH" in found:
        return 0
    return before[NET_OF[pin]]


def made_of(part: str, pos: dict, going: dict, held: dict) -> int:
    """A button is made while held; a roller while its cylinder sits at its end and isn't setting off from it."""
    if KIND[part] == "valve-32-button":
        return held[part]
    label = next(p["label"] for p in PARTS if p["id"] == part)
    cylinder, end = SITS[label]
    at = 0 if end == "retracted" else 1
    setting_off = going[cylinder] == (1 if end == "retracted" else -1)
    return int(pos[cylinder] == at and not setting_off)


def settle(state: dict) -> None:
    """Re-pilots the valves one at a time, in the figure's order, until a whole pass changes nothing."""
    for _ in range(100):
        changed = False
        for part in THREE_TWO:
            now = made_of(part, state["pos"], state["going"], state["held"])
            if now != state["made"][part]:
                state["made"][part] = now
                changed = True
        for valve in FIVE_TWO:
            p14 = pressure(f"{valve}.14", state["spools"], state["made"], state["lines"])
            p12 = pressure(f"{valve}.12", state["spools"], state["made"], state["lines"])
            if p14 and not p12:
                side = "14"
            elif p12 and not p14:
                side = "12"
            else:
                side = state["spools"][valve]
            if side != state["spools"][valve]:
                state["spools"][valve] = side
                changed = True
        for net in NETS:
            level = pressure(net["pins"][0], state["spools"], state["made"], state["lines"])
            if level != state["lines"][net["id"]]:
                state["lines"][net["id"]] = level
                changed = True
        for cylinder in CYLINDERS:
            cap = pressure(f"{cylinder}.cap", state["spools"], state["made"], state["lines"])
            rod = pressure(f"{cylinder}.rod", state["spools"], state["made"], state["lines"])
            drive = 1 if cap and not rod else -1 if rod and not cap else 0
            # A cylinder already at the end it is driven towards stays put.
            if (drive == 1 and state["pos"][cylinder] == 1) or (drive == -1 and state["pos"][cylinder] == 0):
                drive = 0
            if drive != state["going"][cylinder]:
                state["going"][cylinder] = drive
                changed = True
        if not changed:
            return
    raise ValueError("the circuit doesn't settle")


def snapshot(state: dict) -> dict:
    """The circuit at a step line, in the order the figure lists its parts and nets."""
    return {
        "cylinders": {c: state["pos"][c] for c in CYLINDERS},
        "motion": {c: state["going"][c] for c in CYLINDERS},
        "spools": {v: state["spools"][v] for v in FIVE_TWO},
        "lines": {n["id"]: state["lines"][n["id"]] for n in NETS},
        "made": {p: state["made"][p] for p in THREE_TWO},
    }


def at_rest(state: dict) -> bool:
    cylinders = all(state["pos"][p["id"]] == (1 if p["rest"] == "extended" else 0) for p in PARTS if p["kind"] == "cylinder")
    valves = all(state["spools"][p["id"]] == p["rest"] for p in PARTS if p["kind"] == "valve-52")
    return cylinders and valves


def cycle() -> dict:
    state = {
        "pos": {p["id"]: (1 if p["rest"] == "extended" else 0) for p in PARTS if p["kind"] == "cylinder"},
        "going": {c: 0 for c in CYLINDERS},
        "spools": {p["id"]: p["rest"] for p in PARTS if p["kind"] == "valve-52"},
        "held": {p: 0 for p in THREE_TWO if KIND[p] == "valve-32-button"},
        "made": {p: 0 for p in THREE_TWO},
        "lines": {n["id"]: 0 for n in NETS},
    }
    settle(state)
    rest = snapshot(state)
    for button in PRESS:
        state["held"][button] = 1
        settle(state)
        state["held"][button] = 0
        settle(state)
    steps = [snapshot(state)]
    while not (at_rest(state) and not any(state["going"].values()) and len(steps) > 1):
        moving = [c for c in CYLINDERS if state["going"][c] != 0]
        if not moving:
            raise ValueError(f"the cycle stalls at step {len(steps)}")
        if len(steps) > 32:
            raise ValueError("the circuit doesn't come back to rest")
        # Every cylinder that is going reaches its end at once.
        for c in moving:
            state["pos"][c] = 1 if state["going"][c] == 1 else 0
            state["going"][c] = 0
        settle(state)
        steps.append(snapshot(state))
    return {"rest": rest, "steps": steps}


def diagram(trace: dict) -> dict[str, int]:
    """The displacement-step diagram: each cylinder at every step line, each signal line during every movement."""
    values: dict[str, int] = {}
    steps = trace["steps"]
    for k, step in enumerate(steps, start=1):
        for c in CYLINDERS:
            values[f"{c}[{k}]"] = step["cylinders"][c]
        if k < len(steps):
            for s in SIGNALS:
                values[f"{s}[{k}]"] = step["lines"][s]
    return values


def main() -> None:
    trace = cycle()
    values = diagram(trace)
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-cascade.py: each line walked back through the valves to the supply or an exhaust, valves re-piloted one at a time, apart from the engine",
        "inputs": {
            "model": {"parts": PARTS, "nets": NETS, "sequence": SEQUENCE, "press": PRESS, "signals": SIGNALS},
            "start": START,
        },
        "values": values,
        "trace": trace,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    n = len(trace["steps"])
    print(f"wrote {LOG}")
    print(f"step lines 1 to {n}")
    for c in CYLINDERS:
        print(f"{c:>3}: " + " ".join(str(values[f'{c}[{k}]']) for k in range(1, n + 1)))
    for s in SIGNALS:
        print(f"{s:>3}: " + " ".join(str(values[f'{s}[{k}]']) for k in range(1, n)))


if __name__ == "__main__":
    main()

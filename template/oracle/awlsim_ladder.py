"""Runs a ladder or FBD model, compiled to STL, in awlsim at the scans' own times: the build oracle
the ladder engine must agree with bit for bit after every scan.

Called by `oracle/cli.ts` (never by hand): it reads one JSON request on stdin and writes the JSON
result on stdout, after a `@@JSON@@` marker so nothing awlsim prints can corrupt it.

Request:
  { "awl": "<OB 1 and its instance DBs, in awlsim's form>",
    "sizes": { "I": n, "Q": n, "M": n },
    "probe": { "timers": [n...], "counters": [n...], "tons": [db...] },
    "cases": [ { "name": str, "scans": [ { "at": ms, "writes": [ ["I", offset, bit, 0 or 1], ... ] } ] } ] }

Each scan runs at its time: awlsim's clock is held at `at` milliseconds for the whole scan (its
timers and SFB 4 read it), so a run is the same on any machine. Its input bits are written first.

Result, per case and scan: each area as its runs of non-zero bytes ([offset, hex]), each probed S5
timer as [n, Q, running, seconds left] and counter as [n, count], each TON's instance data as
[db, IN, PT, Q, ET, STATE, STIME, ATIME]. A timer's fields are read as they lie, never through a
query, which would settle its Q and change what the next scan does.

Each case starts on a fresh CPU. awlsim is GPL-2.0-or-later and runs here at build only.
"""

import json
import sys

from awlsim.common.project import Project
from awlsim.core.main import AwlSim
from awlsim.awlcompiler.tokenizer import AwlParser
from awlsim.common.cpuconfig import S7CPUConfig
from awlsim.common.util import Logging
from awlsim.common.version import VERSION_STRING
from awlsim.core.memory import AwlMemoryObject_asScalar

Logging.setLoglevel(Logging.LOG_ERROR)

AREAS = ("I", "Q", "M")
TON_FIELDS = ("IN", "PT", "Q", "ET", "STATE", "STIME", "ATIME")


def spans(data):
    """An area's bytes as its runs of non-zero bytes, [offset, hex] each: every other byte is 0."""
    found, start = [], None
    for i, byte in enumerate(data + b"\0"):
        if byte and start is None:
            start = i
        elif not byte and start is not None:
            found.append([start, data[start:i].hex()])
            start = None
    return found


def run_case(awl, sizes, probe, case):
    project = Project.fromProjectOrRawAwlData(awl.encode("utf-8"))
    parser = AwlParser()
    parser.parseSource(project.getAwlSources()[0])
    sim = AwlSim()
    sim.reset()
    sim.registerHardwareClass(hwClass=sim.loadHardwareModule("dummy"), parameters={})
    cpu = sim.getCPU()
    specs = cpu.getSpecs()
    specs.setNrAccus(2)
    specs.setNrInputs(sizes["I"])
    specs.setNrOutputs(sizes["Q"])
    specs.setNrFlags(sizes["M"])
    cpu.getConf().setConfiguredMnemonics(S7CPUConfig.MNEMONICS_EN)
    cpu.getConf().setCycleTimeLimitUs(60_000_000)
    sim.load(parser.getParseTree())
    sim.build()
    sim.startup()

    # The scan's time, held for the whole scan: awlsim reads its clock through updateTimestamp.
    clock = {"now": 0.0}

    def hold_clock(*_args, **_kwargs):
        cpu.now = clock["now"]

    cpu.updateTimestamp = hold_clock

    raw = {"I": cpu.inputs, "Q": cpu.outputs, "M": cpu.flags}
    scans = []
    for scan in case["scans"]:
        clock["now"] = scan["at"] / 1000.0
        for area, offset, bit, value in scan["writes"]:
            memory = raw[area].getRawDataBytes()
            memory[offset] = (memory[offset] | (1 << bit)) if value else (memory[offset] & ~(1 << bit))
        sim.runCycle()
        timers = []
        for n in probe["timers"]:
            t = cpu.getTimer(n)
            timers.append([n, int(t.status), bool(t.running), float(t.remaining)])
        counters = [[n, int(cpu.getCounter(n).counter)] for n in probe["counters"]]
        tons = []
        for db in probe["tons"]:
            instance = cpu.getDB(db).structInstance
            tons.append([db] + [int(AwlMemoryObject_asScalar(instance.getFieldDataByName(f))) for f in TON_FIELDS])
        scans.append({
            "at": scan["at"],
            "memory": {a: spans(bytes(raw[a].getRawDataBytes()[: sizes[a]])) for a in AREAS},
            "timers": timers,
            "counters": counters,
            "tons": tons,
        })
    sim.shutdown()
    return {"name": case["name"], "scans": scans}


def main():
    request = json.load(sys.stdin)
    result = {
        "awlsim": VERSION_STRING,
        "cases": [run_case(request["awl"], request["sizes"], request["probe"], c) for c in request["cases"]],
    }
    sys.stdout.write("@@JSON@@" + json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()

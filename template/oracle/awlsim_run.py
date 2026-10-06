"""Runs STL listings in awlsim, the build oracle the S7 core's STL interpreter must agree with bit for bit.

Called by `oracle/cli.ts` (never by hand): it reads one JSON request on stdin and writes the JSON
result on stdout, after a `@@JSON@@` marker so nothing awlsim prints can corrupt it.

Request:
  { "awl": "<the listing in awlsim's form, plus the library FCs in STL>",
    "sizes": { "I": n, "Q": n, "M": n },               # bytes of each area, as the engine has them
    "cases": [ { "name": str,
                 "scans": [ [ ["I" or "M", offset, [bytes]] or ["I" or "M", offset, bit, 0 or 1], ... ] ] } ] }
  Each scan's input writes are made in order before it runs, as the engine makes them.

Result, per case and scan:
  "steps":  one row per OB 1 statement: [line, ACCU 1, ACCU 2, AR 1, status word, writes], where
            writes are the bytes the statement changed, [area, offset, new byte] each. A library
            block's own statements are not rows: what it writes belongs to its CALL's row.
  "memory": each area after the scan, as its runs of non-zero bytes ([offset, hex] each).

Each case starts on a fresh CPU, the way the engine starts one: every area zeroed. awlsim is
GPL-2.0-or-later and runs here at build only (the machine venv, or CI's); nothing of it ships.
"""

import json
import sys

# awlsim's modules import each other by `*`: this order (project, core, compiler) is the one that
# leaves every name defined.
from awlsim.common.project import Project
from awlsim.core.main import AwlSim
from awlsim.awlcompiler.tokenizer import AwlParser
from awlsim.common.cpuconfig import S7CPUConfig
from awlsim.common.util import Logging
from awlsim.common.version import VERSION_STRING

Logging.setLoglevel(Logging.LOG_ERROR)

AREAS = ("I", "Q", "M")


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


def run_case(awl, sizes, case):
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
    # A loop over many set-points runs long under the per-statement callback: allow a minute a scan.
    cpu.getConf().setCycleTimeLimitUs(60_000_000)
    sim.load(parser.getParseTree())
    sim.build()
    sim.startup()

    raw = {"I": cpu.inputs, "Q": cpu.outputs, "M": cpu.flags}
    snapshot = lambda: {area: bytes(raw[area].getRawDataBytes()[: sizes[area]]) for area in AREAS}
    state = {"before": None, "steps": []}

    def changes():
        now = snapshot()
        found = []
        for area in AREAS:
            old, new = state["before"][area], now[area]
            if old != new:
                found.extend([area, i, new[i]] for i in range(len(new)) if old[i] != new[i])
        state["before"] = now
        return found

    def post_insn(cse, _data):
        writes = changes()
        if type(cse.block).__name__ != "OB":
            # A library block's statement: what it writes belongs to the CALL that ran it.
            if state["steps"]:
                state["steps"][-1][5].extend(writes)
            return
        insn = cse.insns[cse.ip]
        state["steps"].append([
            insn.getLineNr(),
            cpu.accu1.get() & 0xFFFFFFFF,
            cpu.accu2.get() & 0xFFFFFFFF,
            cpu.ar1.get() & 0xFFFFFFFF,
            cpu.statusWord.getWord(),
            writes,
        ])

    cpu.setPostInsnCallback(post_insn)
    scans = []
    for scan in case["scans"]:
        for write in scan:
            memory = raw[write[0]].getRawDataBytes()
            if len(write) == 3:  # [area, offset, bytes]
                memory[write[1] : write[1] + len(write[2])] = bytearray(write[2])
            else:  # [area, offset, bit, value]: one bit of its byte
                area, offset, bit, value = write
                memory[offset] = (memory[offset] | (1 << bit)) if value else (memory[offset] & ~(1 << bit))
        state["before"], state["steps"] = snapshot(), []
        sim.runCycle()
        scans.append({"steps": state["steps"], "memory": {area: spans(data) for area, data in snapshot().items()}})
    sim.shutdown()
    return {"name": case["name"], "scans": scans}


def main():
    request = json.load(sys.stdin)
    result = {
        "awlsim": VERSION_STRING,
        "cases": [run_case(request["awl"], request["sizes"], case) for case in request["cases"]],
    }
    sys.stdout.write("@@JSON@@" + json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()

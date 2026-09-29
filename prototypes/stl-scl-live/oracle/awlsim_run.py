# PROTOTYPE (throwaway, ticket #37): run an STL program in awlsim, the build oracle.
# Reads JSON on stdin:
#   { "awl": "<full AWL source>", "cases": [ { "name": str,
#       "init": { "M": [[offset, [bytes...]], ...] },           # optional preload before scan 1
#       "scans": [ { "I": [[offset, [bytes...]], ...] }, ... ]  # process-image inputs per scan
#   } ] }
# Writes JSON on stdout: per case, per scan: M, Q bytes (hex), ACCU1, ACCU2, AR1, status word.
# The dummy hardware module makes a PIW read return the process-image input at that offset.
# Needs AWLSIM_DIR pointing at an awlsim source checkout (GPL-2.0-or-later, not vendored here).
import json, os, sys

sys.path.insert(0, os.environ["AWLSIM_DIR"])
from awlsim.common.project import Project
from awlsim.core.main import AwlSim
from awlsim.awlcompiler.tokenizer import AwlParser
from awlsim.common.cpuconfig import S7CPUConfig
from awlsim.common.util import Logging

Logging.setLoglevel(Logging.LOG_ERROR)

req = json.load(sys.stdin)
out = []
for case in req["cases"]:
    project = Project.fromProjectOrRawAwlData(req["awl"].encode("utf-8"))
    p = AwlParser()
    p.parseSource(project.getAwlSources()[0])
    s = AwlSim()
    s.reset()
    s.registerHardwareClass(hwClass=s.loadHardwareModule("dummy"), parameters={})
    cpu = s.getCPU()
    cpu.getSpecs().setNrAccus(2)
    cpu.getSpecs().setNrInputs(512)
    cpu.getConf().setConfiguredMnemonics(S7CPUConfig.MNEMONICS_EN)
    s.load(p.getParseTree())
    s.build()
    s.startup()
    for off, data in case.get("init", {}).get("M", []):
        cpu.flags.getRawDataBytes()[off:off + len(data)] = bytearray(data)
    scans = []
    steps = []
    def post_insn(cse, _data):
        insn = cse.insns[cse.ip]
        if type(cse.block).__name__ != "OB":
            return
        steps.append([insn.getLineNr(), str(insn).split()[0] if str(insn).strip() else "",
                      cpu.accu1.get() & 0xFFFFFFFF, cpu.accu2.get() & 0xFFFFFFFF,
                      cpu.ar1.get() & 0xFFFFFFFF, cpu.statusWord.getWord()])
    cpu.setPostInsnCallback(post_insn)
    for scan in case["scans"]:
        steps = []
        for off, data in scan.get("I", []):
            cpu.storeInputRange(off, bytearray(data))
        s.runCycle()
        scans.append({
            "M": bytes(cpu.flags.getRawDataBytes()[0:128]).hex(),
            "Q": bytes(cpu.outputs.getRawDataBytes()[0:16]).hex(),
            "ACCU1": cpu.accu1.get() & 0xFFFFFFFF,
            "ACCU2": cpu.accu2.get() & 0xFFFFFFFF,
            "AR1": cpu.ar1.get() & 0xFFFFFFFF,
            "STW": cpu.statusWord.getWord(),
            "steps": steps,
        })
    s.shutdown()
    out.append({"name": case["name"], "scans": scans})
sys.stdout.write("@@JSON@@" + json.dumps(out))

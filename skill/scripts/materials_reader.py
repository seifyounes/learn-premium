"""The Materials reader's command line: `python materials_reader.py read --materials M --private P
<file>`, run with the machine venv's Python. Commands, flags and exit codes: reader/README.md."""

import json
import sys
import traceback

from reader.cli import run


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        code, report = run(sys.argv[1:])
    except Exception as e:
        # A bug, not a refusal: say so in the same JSON shape, and keep the stack for whoever debugs it.
        traceback.print_exc()
        code, report = 4, {"ok": False, "error": f"internal error: {e}"}
    print(json.dumps(report, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())

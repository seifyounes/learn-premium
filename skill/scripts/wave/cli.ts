// The Module wave's command interface: argv in, exit code and one JSON document out.
// Commands, flags and exit codes: README.md. Exit codes: 0 done; 1 open work (disputes to settle,
// a wave not ready to merge); 2 bad arguments or input; 3 refused. The entry (../wave.ts) adds 4.
import { privateFolderOf } from "../intake/create.ts";
import { Args, readJson } from "../ledger/args.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { moduleId } from "../ledger/model.ts";
import { isoTime, oneOf, SchemaError } from "../ledger/schema.ts";
import { LedgerError } from "../ledger/store.ts";
import { assign, confirmDiscipline, fallback } from "./assign.ts";
import { handback } from "./handback.ts";
import { reconcile, reconcileSitting } from "./reading.ts";
import { relaunchClose, relaunchOpen, templateJobGates, type JobGates } from "./relaunch.ts";
import { reviewReport } from "./review.ts";
import { sittingCheckpoint, templateDump, type SittingDumper } from "./sitting.ts";
import { sittingTree } from "./tree.ts";
import { hideDead, neverUse, verifyVideos, type VideoTemplate } from "./videos.ts";
import { checkpoint, moduleFolder, readyProblems, templateVerifier, templateVideos, type Verifier } from "./wave.ts";

export interface WaveDeps {
  verifier: Verifier;
  jobGates: JobGates;
  /** Reads a sitting's content as written (the template's `gates sitting`), for a Sitting wave. */
  dump: SittingDumper;
  /** The template's YouTube card list, probe and hide, for a Module wave's cards. */
  videos: VideoTemplate;
}

export interface RunResult {
  code: number;
  stdout: string;
}

export function run(args: string[], deps: Partial<WaveDeps> = {}): RunResult {
  try {
    const { code = 0, ...out } = dispatch(new Args(args), {
      verifier: templateVerifier,
      jobGates: templateJobGates,
      dump: templateDump,
      videos: templateVideos,
      ...deps,
    });
    return { code, stdout: JSON.stringify({ ok: code === 0, ...out }) };
  } catch (error) {
    if (error instanceof LedgerError) return failure(error.kind === "refused" ? 3 : 2, error.message);
    if (error instanceof SchemaError) return failure(2, error.message);
    throw error;
  }
}

const failure = (code: number, error: string): RunResult => ({ code, stdout: JSON.stringify({ ok: false, error }) });

type Output = { code?: number } & Record<string, unknown>;

function dispatch(args: Args, deps: WaveDeps): Output {
  const command = args.command();
  const project = args.required("--project");
  switch (command) {
    case "reconcile": {
      const sitting = args.optional("--sitting");
      const ledger = requireLedger(project);
      const privateFolder = privateFolderOf(ledger.intake.materialsPath);
      const result =
        sitting === undefined
          ? reconcile(privateFolder, moduleId(args.required("--module"), "--module"))
          : reconcileSitting(privateFolder, sitting);
      if (!result.settledNow) {
        return {
          code: 1,
          agreed: result.agreed,
          disputes: result.disputes,
          next: "settle each dispute on its rendered region: crop it (materials_reader.py crop), then rule on it in resolutions.json",
        };
      }
      const { agreed, disputes, settled, checkpointItems } = result;
      return { agreed, disputes, settled, checkpointItems };
    }
    case "checkpoint": {
      const sitting = args.optional("--sitting");
      if (sitting !== undefined) {
        // The announced format's item reads the content: HEAD's dump in the sitting's own checkout.
        const ledger = requireLedger(project);
        const content = deps.dump(sittingTree(project, ledger, sitting), sitting);
        return {
          ...sittingCheckpoint(
            project,
            sitting,
            typeof content === "string" ? null : content,
            args.optional("--preview"),
          ),
        };
      }
      const module = moduleId(args.required("--module"), "--module");
      return { ...checkpoint(project, module, args.optional("--preview")) };
    }
    case "review": {
      const module = moduleId(args.required("--module"), "--module");
      const ledger = requireLedger(project);
      return reviewReport(privateFolderOf(ledger.intake.materialsPath), module, moduleFolder(ledger, module).folder);
    }
    case "relaunch": {
      const [holder, waveId, job] = [args.required("--holder"), args.required("--wave"), args.required("--job")];
      switch (args.subcommand()) {
        case "open":
          return relaunchOpen(project, holder, waveId, job, args.list("--files"), deps.jobGates);
        case "close":
          return relaunchClose(project, holder, waveId, job, readJson(args.required("--outcomes")), deps.jobGates);
        default:
          throw new LedgerError("invalid", "relaunch takes open or close");
      }
    }
    case "ready": {
      const problems = readyProblems(project, args.required("--wave"), deps.verifier, deps.dump, deps.videos);
      return { code: problems.length === 0 ? 0 : 1, ready: problems.length === 0, problems };
    }
    case "assign":
      return assign(project, args.required("--holder"), args.required("--wave"), readJson(args.required("--input")));
    case "discipline":
      return confirmDiscipline(
        project,
        args.required("--holder"),
        args.required("--wave"),
        args.required("--name"),
        oneOf("yes", "no")(args.required("--confirmed"), "--confirmed") === "yes",
        args.required("--answer"),
      );
    case "handback":
      return handback(
        project,
        args.required("--holder"),
        args.required("--wave"),
        args.required("--name"),
        deps.verifier,
      );
    case "fallback":
      return fallback(
        project,
        args.required("--holder"),
        args.required("--wave"),
        args.required("--job"),
        isoTime(args.required("--started-at"), "--started-at"),
      );
    case "videos": {
      const privateFolder = privateFolderOf(requireLedger(project).intake.materialsPath);
      switch (args.subcommand()) {
        case "verify":
          return verifyVideos(project, privateFolder, moduleId(args.required("--module"), "--module"), deps.videos);
        case "hide":
          return hideDead(project, privateFolder, args.required("--report"), deps.videos);
        case "never":
          return neverUse(privateFolder, args.required("--id"), args.required("--reason"));
        default:
          throw new LedgerError("invalid", "videos takes verify, hide or never");
      }
    }
    default:
      throw new LedgerError("invalid", `unknown command: ${command}`);
  }
}

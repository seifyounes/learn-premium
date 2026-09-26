// PROTOTYPE check (side-by-side, not upstream): the two-conveyor program run through the app's own
// interpreter (parseSTToAST + runScanCycle) and its real zustand simulation store, 100 ms scan.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { parseSTToAST } from './transformer/ast';
import { runScanCycle } from './interpreter/program-runner';
import { createRuntimeState, type SimulationStoreInterface } from './interpreter/execution-context';
import { initializeVariables } from './interpreter/variable-initializer';
import { useSimulationStore } from './store/simulation-store';

export const ST = `PROGRAM TwoConveyorStart
VAR
  START : BOOL;          (* START push button, NO: TRUE while pressed *)
  STOP : BOOL := TRUE;   (* STOP push button, NC: TRUE at rest *)
  M1 : BOOL;             (* conveyor 1 motor *)
  M2 : BOOL;             (* conveyor 2 motor *)
  T1 : TON;
END_VAR
M1 := (START OR M1) AND STOP;
T1(IN := M1, PT := T#5s);
M2 := T1.Q;
END_PROGRAM
`;

it('two-conveyor timeline', () => {
  useSimulationStore.getState().reset();
  const ast = parseSTToAST(ST);
  const S = () => useSimulationStore.getState() as unknown as SimulationStoreInterface;
  initializeVariables(ast, S());
  const rt = createRuntimeState(ast);
  const scan = S().scanTime;
  const ev: Record<number, Record<string, boolean>> = { 0: { START: true }, 1000: { START: false }, 8000: { STOP: false }, 8500: { STOP: true }, 9000: { START: true, STOP: false }, 9500: { START: false, STOP: true }, 10000: { START: true }, 10200: { START: false } };
  const want: Record<number, [boolean, boolean, number]> = { 0: [true, false, 0], 1000: [true, false, 1000], 4900: [true, false, 4900], 5000: [true, true, 5000], 5100: [true, true, 5000], 7000: [true, true, 5000], 8000: [false, false, 0], 8100: [false, false, 0], 8500: [false, false, 0], 9000: [false, false, 0], 10000: [true, false, 0], 10200: [true, false, 200], 14900: [true, false, 4900], 15000: [true, true, 5000] };
  const lines: string[] = [`scanTime ${scan} ms; STOP initial ${S().getBool('STOP')}`];
  let fails = 0;
  for (let t = 0; t <= 15000; t += scan) {
    for (const [k, v] of Object.entries(ev[t] || {})) S().setBool(k, v);
    runScanCycle(ast, S(), rt);
    if (want[t]) {
      const T = S().getTimer('T1');
      const got: [boolean, boolean, number] = [S().getBool('M1'), S().getBool('M2'), T?.ET ?? -1];
      const ok = got[0] === want[t][0] && got[1] === want[t][1] && got[2] === want[t][2];
      if (!ok) fails++;
      lines.push(`${ok ? 'PASS' : 'FAIL'} t=${(t / 1000).toFixed(2)} s  M1 ${+got[0]} (want ${+want[t][0]})  M2 ${+got[1]} (want ${+want[t][1]})  T1.ET ${got[2]} (want ${want[t][2]})`);
    }
  }
  lines.push(`${Object.keys(want).length - fails}/${Object.keys(want).length} checkpoints PASS`);
  writeFileSync('zz-two-conveyor.result.txt', lines.join('\n'));
  console.log(lines.join('\n'));
});

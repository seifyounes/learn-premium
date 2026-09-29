// PROTOTYPE (throwaway, ticket #37): Owner rulings on Professor-vs-Siemens divergences.
// The engine always behaves like a real S7. On a ruled line the trace shows both: the Professor's
// stated result, marked as the exam answer, and a red-pen note saying what a real S7 does.
// BOTH RULINGS BELOW ARE DEMOS written for the prototype; no real ruling has been made.
import { f32, int16 } from '../s7core.mjs';

export const rulings = [
  {
    id: 'fc105-out-of-range',
    demo: true,
    listing: 'tank',
    anchor: 'CALL  FC   105',
    professor: 'An input beyond the range keeps scaling past HI_LIM.',
    s7: 'FC105 clamps OUT to HI_LIM (or LO_LIM) and returns RET_VAL W#16#0008.',
    // ctx: { params: {IN, HI_LIM, LO_LIM, BIPOLAR}, out: {OUT, RET_VAL} }
    applies: (ctx) => ctx.out.RET_VAL === 8,
    examAnswer: (ctx) => {
      const K1 = ctx.params.BIPOLAR ? -27648 : 0, K2 = 27648;
      const q = f32(f32(f32(int16(ctx.params.IN)) - K1) / (K2 - K1));
      return { kind: 'real', label: 'OUT (level h, m)', value: f32(f32(q * f32(ctx.params.HI_LIM - ctx.params.LO_LIM)) + ctx.params.LO_LIM) };
    },
  },
  {
    id: 'int-overflow',
    demo: true,
    listing: 'tank',
    anchor: '+I                              // INT add',
    professor: 'An INT overflow stops the PLC.',
    s7: 'The sum wraps to a 16-bit INT, OV and OS go to 1, and the scan carries on.',
    applies: (ctx) => ctx.stw.OV === 1,
    examAnswer: () => ({ kind: 'text', label: 'CPU', value: 'goes to STOP' }),
  },
];

export const rulingLine = (lines, r) => lines.findIndex((l) => l.includes(r.anchor));

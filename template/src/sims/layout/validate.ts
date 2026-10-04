// What a schematic model and its Layout hints must hold before the engine can draw them: every pin
// of every part in exactly one net, and one hint per part. The content contract reports these.
import { splitPin, type LayoutHints, type SchematicModel } from "./drawing.ts";
import { pinNames } from "./symbols.ts";

export function schematicProblems(model: SchematicModel, hints: LayoutHints): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const part of model.parts) {
    if (ids.has(part.id)) out.push(`part ${part.id} is listed twice`);
    ids.add(part.id);
  }
  const netIds = new Set<string>();
  const placed = new Map<string, string>();
  for (const net of model.nets) {
    if (netIds.has(net.id)) out.push(`net ${net.id} is listed twice`);
    netIds.add(net.id);
    for (const pin of net.pins) {
      const [id, name] = splitPin(pin);
      const part = model.parts.find((p) => p.id === id);
      if (!part) out.push(`net ${net.id} names ${pin}, but the model has no part ${id}`);
      else if (!pinNames(part.kind).includes(name))
        out.push(`net ${net.id} names ${pin}, but a ${part.kind} has pins ${pinNames(part.kind).join(", ")}`);
      const other = placed.get(pin);
      if (other !== undefined) out.push(`${pin} is in nets ${other} and ${net.id}: a pin is in one net`);
      placed.set(pin, net.id);
    }
  }
  for (const part of model.parts) {
    for (const name of pinNames(part.kind))
      if (!placed.has(`${part.id}.${name}`)) out.push(`${part.id}.${name} is in no net`);
  }
  for (const part of model.parts) if (!(part.id in hints.parts)) out.push(`part ${part.id} has no layout hint`);
  for (const id of Object.keys(hints.parts))
    if (!ids.has(id)) out.push(`the layout hints place ${id}, which the model doesn't have`);
  for (const net of hints.dots ?? [])
    if (!netIds.has(net)) out.push(`the layout hints dot net ${net}, which the model doesn't have`);
  return out;
}

// A Summary beat's one figure, plotted on the sheet at rest: rendered at build, with no island.
import { PlotFigure } from "../islands/worked/PlotFigure.tsx";
import { atRest, type FigureData } from "../worked/sheet.ts";

export default function BeatFigure({ figure, captionId }: { figure: FigureData; captionId: string }) {
  const shown = { state: atRest(figure), hidden: false, animate: false, epoch: 0 };
  return <PlotFigure figure={figure} shown={shown} captionId={captionId} />;
}

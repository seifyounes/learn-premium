import { useState } from "react";

interface Props {
  /** The model working, already rendered to HTML (paper math) at build. */
  modelHtml: string;
  answer: { value: number; tolerance: number };
  /** The answer's unit, rendered to HTML at build like any prose field. */
  unitHtml: string;
}

/** Keeps the model answer hidden until the student has tried the item. */
export default function RevealAnswer({ modelHtml, answer, unitHtml }: Props) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <button type="button" onClick={() => setShown(true)} className="button-print label-action">
        Show model answer
      </button>
    );
  }
  return (
    <div className="text-body">
      <div dangerouslySetInnerHTML={{ __html: modelHtml }} />
      <p className="font-quantity text-pencil">
        {answer.value} <span dangerouslySetInnerHTML={{ __html: unitHtml }} /> (± {answer.tolerance})
      </p>
    </div>
  );
}

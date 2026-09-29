import { useState } from "react";

interface Props {
  /** The model answer, already rendered to HTML (paper math) at build. */
  html: string;
}

/** Keeps the model answer hidden until the student has tried the item. */
export default function RevealAnswer({ html }: Props) {
  const [shown, setShown] = useState(false);
  if (shown) return <div className="text-body" dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <button
      type="button"
      onClick={() => setShown(true)}
      className="h-[42px] border-[1.5px] border-print bg-sheet px-4 font-print text-label-action font-bold tracking-[0.08em] text-print uppercase transition-colors duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--color-print)_10%,var(--color-sheet))]"
    >
      Show model answer
    </button>
  );
}

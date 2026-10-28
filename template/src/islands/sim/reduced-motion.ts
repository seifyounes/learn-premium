// Whether the reader asks for reduced motion, as a hook that follows the setting while the page is
// open (motion's own `useReducedMotion` doesn't re-render on a media change). The server and the
// first client render say no; an effect reads the media query, so the markup always hydrates.
import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

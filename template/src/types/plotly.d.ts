// The little of Plotly's API the heatmap uses. Plotly's own types cover its whole bundle, not the
// core and trace modules the heatmap imports.
declare module "plotly.js/lib/core" {
  type Data = Record<string, unknown>;
  type Layout = Record<string, unknown>;
  interface Config {
    staticPlot?: boolean;
    responsive?: boolean;
    displayModeBar?: boolean;
    displaylogo?: boolean;
  }
  interface Plotly {
    register(modules: unknown[]): void;
    react(el: HTMLElement, data: Data[], layout?: Layout, config?: Config): Promise<HTMLElement>;
    purge(el: HTMLElement): void;
    Plots: { resize(el: HTMLElement): Promise<void> | void };
  }
  const plotly: Plotly;
  export default plotly;
}

declare module "plotly.js/lib/heatmap" {
  const trace: unknown;
  export default trace;
}

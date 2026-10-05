// The little of Plotly's API the heatmap uses. The cartesian dist bundle ships no types of its own.
declare module "plotly.js-cartesian-dist-min" {
  type Data = Record<string, unknown>;
  type Layout = Record<string, unknown>;
  interface Config {
    staticPlot?: boolean;
    responsive?: boolean;
    displayModeBar?: boolean;
    displaylogo?: boolean;
  }
  interface Plotly {
    react(el: HTMLElement, data: Data[], layout?: Layout, config?: Config): Promise<HTMLElement>;
    purge(el: HTMLElement): void;
    Plots: { resize(el: HTMLElement): Promise<void> | void };
  }
  const plotly: Plotly;
  export default plotly;
}

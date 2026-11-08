import { lazy, type ComponentProps, type ComponentType } from "react";

// Views that aren't on screen at startup load in their own chunks, so the inbox appears sooner.
// They're fetched in the background right after the first paint. Once loaded they render
// directly, without suspending (React would otherwise hold the fallback for a moment).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function view<C extends ComponentType<any>>(load: () => Promise<C>) {
  let loaded: C | null = null;
  const preload = () => load().then((c) => (loaded = c));
  const Lazy = lazy(() => preload().then((c) => ({ default: c })));
  const View = (props: ComponentProps<C>) => {
    const Comp = (loaded ?? Lazy) as ComponentType<ComponentProps<C>>;
    return <Comp {...props} />;
  };
  return Object.assign(View, { preload });
}

export const AnalysisView = view(() => import("./components/AnalysisView").then((m) => m.AnalysisView));
export const GuidedReview = view(() => import("./components/GuidedReview").then((m) => m.GuidedReview));
export const DiffView = view(() => import("./components/DiffView").then((m) => m.DiffView));
export const Settings = view(() => import("./components/Settings").then((m) => m.Settings));
export const SubmitReview = view(() => import("./components/SubmitReview").then((m) => m.SubmitReview));
export const FilterDialog = view(() => import("./components/FilterDialog").then((m) => m.FilterDialog));
export const DescriptionDialog = view(() => import("./components/DescriptionDialog").then((m) => m.DescriptionDialog));
export const InfoDialog = view(() => import("./components/InfoDialog").then((m) => m.InfoDialog));
export const CommandPalette = view(() => import("./components/CommandPalette").then((m) => m.CommandPalette));
export const MarkdownRenderer = view(() => import("./components/MarkdownRenderer").then((m) => m.default));

const all = [AnalysisView, GuidedReview, DiffView, Settings, SubmitReview, FilterDialog, DescriptionDialog, InfoDialog, CommandPalette, MarkdownRenderer];

export function preloadViews() {
  const run = () => all.forEach((v) => v.preload().catch(() => {}));
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 300);
}

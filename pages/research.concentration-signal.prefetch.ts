import type { PagePrefetchFn } from "@runtime/prefetch";
import { mppStore } from "../helpers/mppStore";
import { STUDY_KEY } from "../helpers/concentrationSignal";
import { LEVEL_KEY } from "../helpers/concentrationLevel";

// Server-render the study so crawlers and link previews see the numbers.
export const prefetch: PagePrefetchFn = async ({ qc }) => {
  const r = await mppStore.get(STUDY_KEY).catch(() => null);
  if (r) qc.setQueryData(["concentration-signal"], JSON.parse(JSON.stringify(r)));
  const l = await mppStore.get(LEVEL_KEY).catch(() => null);
  if (l) qc.setQueryData(["concentration-level"], JSON.parse(JSON.stringify(l)));
  return { maxAge: 1800 };
};
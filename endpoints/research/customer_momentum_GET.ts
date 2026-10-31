import { mppStore } from "../../helpers/mppStore";

type Stat = { n: number; dates: number; mean: number | null; t: number | null; p: number | null };

// Latest customer-momentum backtest result (free, public: the evidence behind the dependency product).
// The conclusion is derived mechanically from the pre-registered test (linked minus placebo, p < 0.05),
// so the headline can never overstate the statistics underneath it.
export async function handle(_request: Request) {
  const result = (await mppStore.get("research:customer-momentum:v1")) as
    | ({ primary?: { linkedMinusPlacebo?: Stat; supplierDay0SameSign?: Stat } } & Record<string, unknown>)
    | null;
  if (!result) return Response.json({ status: "not_run", message: "Backtest has not been run yet." }, { status: 404 });
  const diff = result.primary?.linkedMinusPlacebo;
  const day0 = result.primary?.supplierDay0SameSign;
  const supported = !!diff && diff.p !== null && diff.p < 0.05 && (diff.mean ?? 0) > 0;
  const conclusion = supported
    ? "Supported: disclosed suppliers drift in the direction of a major customer's shock beyond random suppliers (p < 0.05)."
    : "Not supported: no statistically significant supplier drift beyond the placebo control. No trading signal is published.";
  const pricedSameDay = !!day0 && day0.p !== null && day0.p < 0.05 && (day0.mean ?? 0) > 0;
  return Response.json(
    {
      conclusion,
      signalPublished: supported,
      sameDayLinkagePriced: pricedSameDay,
      ...result,
    },
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
  );
}

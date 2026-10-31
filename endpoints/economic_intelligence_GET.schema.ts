import type {economicIntelligence} from "../helpers/economicIntelligence";
export type OutputType=Awaited<ReturnType<typeof economicIntelligence>>;
export async function getEconomicIntelligence():Promise<OutputType>{
 const r=await fetch("/_api/economic_intelligence",{signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error("Economic intelligence is temporarily unavailable. Please retry.");return r.json();
}
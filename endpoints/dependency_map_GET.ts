import { dependencyAtlas, type AtlasEvent } from "../helpers/dependencyAtlas";
import { fetchGlobalOfficialSignals } from "../helpers/globalSources";
import { fetchGlobalNews } from "../helpers/globalNews";
import { PUBLISH_NEWS_HEADLINES } from "../helpers/licensing";
export async function handle() {
 const results = await Promise.allSettled([fetchGlobalOfficialSignals(), PUBLISH_NEWS_HEADLINES ? fetchGlobalNews() : Promise.resolve([])]);
 const official = results[0].status === "fulfilled" ? results[0].value : null;
 const news = results[1].status === "fulfilled" ? results[1].value : [];
 const events: AtlasEvent[] = [
  ...(official?.disclosures ?? []).map(d=>({id:d.id,title:d.title,url:d.url,source:d.source,publishedAt:d.filedAt,kind:"filing" as const})),
  ...(official?.procurement ?? []).map(d=>({id:d.id,title:d.title,url:d.url,source:d.source,publishedAt:d.publishedAt,kind:"procurement" as const})),
  ...news.map(d=>({id:d.id,title:d.title,url:d.url,source:d.source,publishedAt:d.publishedAt,kind:"news" as const}))
 ];
 return Response.json({
  generatedAt:new Date().toISOString(),channels:dependencyAtlas.analyze(events),eventCount:events.length,
  sources:{sec:official?.sources.sec??"error",ted:official?.sources.ted??"error",news:results[1].status==="fulfilled"?(news.length?"ok":"empty"):"error"},
  coverage:"Selected SEC issuers, a limited EU TED procurement sample and international news feeds. Coverage is not exhaustive and does not include full-document verification. Dated headlines from the last 30 days are matched to global economic mechanisms."
 },{headers:{"Cache-Control":"public, s-maxage=300","Content-Type":"application/json"}});
}
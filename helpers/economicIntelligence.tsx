import {sql} from "kysely";
import {db} from "./db";
import {dependencyAtlas,type AtlasEvent} from "./dependencyAtlas";
import {fetchGlobalOfficialSignals} from "./globalSources";
import {fetchGlobalNews} from "./globalNews";
import {globalMarkets} from "./globalMarkets";
import {mppStore} from "./mppStore";
import {forwardResearch,type ResearchTrade} from "./forwardResearch";
import {eventExecution} from "./eventExecution";
export const CHANNEL_SYMBOLS:Record<string,string[]>={
 "ai-power":["GEV","ETN","NVDA","MSFT","AMZN"],"capital-ai":["GEV","ETN","MSFT","AMZN","GOOGL"],
 shipping:["UPS","FDX","XOM","SHEL"],dollar:["JPM","GS","BABA","INFY"]
};
export async function economicIntelligence(){
 const cached=await mppStore.get("economic:hub:en:v3") as {at:number;data:unknown}|null;
 if(cached&&Date.now()-cached.at<120000)return cached.data as Awaited<ReturnType<typeof build>>;
 const data=await build();await mppStore.put("economic:hub:en:v3",{at:Date.now(),data});return data;
}
async function build(){
 const fetched=await Promise.allSettled([fetchGlobalOfficialSignals(),fetchGlobalNews(),globalMarkets()]);
 const official=fetched[0].status==="fulfilled"?fetched[0].value:null;
 const news=fetched[1].status==="fulfilled"?fetched[1].value:[];
 const market=fetched[2].status==="fulfilled"?fetched[2].value:null;
 const events:AtlasEvent[]=[
 ...(official?.disclosures??[]).map(d=>({id:d.id,title:d.title,url:d.url,source:d.source,publishedAt:d.filedAt,kind:"filing" as const})),
 ...(official?.procurement??[]).map(d=>({id:d.id,title:d.title,url:d.url,source:d.source,publishedAt:d.publishedAt,kind:"procurement" as const})),
 ...news.map(d=>({id:d.id,title:d.title,url:d.url,source:d.source,publishedAt:d.publishedAt,kind:"news" as const}))];
 const channels=dependencyAtlas.analyze(events).map(c=>({
 ...c,decision:c.matches.length?"RESEARCH":"WAIT",
 evidenceLevel:"title_match_only",pricingStatus:"not_assessed",
 candidateSelection:"Predefined sector exposure, not verified supplier contracts",
 quotes:(market?.quotes??[]).filter(q=>(CHANNEL_SYMBOLS[c.id]??[]).includes(q.symbol)).map(q=>({...q,
 quoteFresh:!!q.marketTime&&Date.now()-q.marketTime*1000<30*60000&&q.marketTime*1000<=Date.now()+60000})),
 missing:["Confirm event direction in the full primary document","Verify the named beneficiary and binding order or exposure","Estimate materiality and compare to market expectations","Test incremental return after costs against a benchmark"],
 nextAction:c.matches.length?"Open primary evidence, confirm the direction and named beneficiaries; then compare materiality with expectations.":"No recent matching event; wait for evidence."
 }));
 const [coverage,validation,ledger,journal,exposures,incidents,revenue]=await Promise.all([
 db.selectFrom("radarServices").select(({fn})=>[fn.countAll<number>().as("total"),sql<number>`count(*) FILTER (WHERE hosting_provider IS NOT NULL)::int`.as("hosting"),sql<number>`count(*) FILTER (WHERE hosting_region IS NOT NULL)::int`.as("region"),sql<number>`count(*) FILTER (WHERE cdn IS NOT NULL)::int`.as("cdn")]).where("active","=",true).executeTakeFirst(),
 sql<{runId:string;generatedAt:Date;testsPerformed:number;trainSurvivors:number;published:number}>`SELECT r.run_id AS "runId",r.generated_at AS "generatedAt",r.tests_performed AS "testsPerformed",r.train_survivors AS "trainSurvivors",(SELECT count(*)::int FROM lead_lag_signals s WHERE s.run_id=r.run_id) AS published FROM lead_lag_runs r ORDER BY generated_at DESC LIMIT 1`.execute(db),
 db.selectFrom("economicResearchTrades").select(["payload"]).orderBy("firstObservedAt").execute(),
 db.selectFrom("economicEventJournal").selectAll().orderBy("firstObservedAt","desc").limit(100).execute(),
 sql<{supplier:string;supplierTicker:string;customer:string;customerTicker:string;share:number;filedAt:Date;docUrl:string}>`WITH latest AS (SELECT filer_cik,max(filed_at) AS filed_at FROM customer_concentration_facts WHERE benchmark='revenue' GROUP BY filer_cik)
 SELECT DISTINCT ON (f.filer_cik,f.customer_ticker) f.filer_name AS supplier,f.filer_ticker AS "supplierTicker",f.customer_name AS customer,f.customer_ticker AS "customerTicker",f.share,f.filed_at AS "filedAt",f.doc_url AS "docUrl"
 FROM customer_concentration_facts f JOIN latest l ON l.filer_cik=f.filer_cik AND l.filed_at=f.filed_at
 WHERE f.benchmark='revenue' AND f.customer_ticker IN ('AMZN','MSFT','GOOGL','META','AAPL','NVDA') AND f.filed_at>now()-interval '2 years'
 ORDER BY f.filer_cik,f.customer_ticker,f.period_end DESC LIMIT 20`.execute(db),
 db.selectFrom("radarIncidents").select(["id","layer","provider","startedAt","affected","evidence"]).where("status","=","open").orderBy("startedAt","desc").limit(10).execute(),
 sql<{paidUsage:number;usageRevenueUsd:string;paidDatasetKeys:number;activeAlerts:number}>`SELECT (SELECT count(*)::int FROM machine_usage WHERE price_usd>0) AS "paidUsage",COALESCE((SELECT sum(price_usd) FROM machine_usage WHERE price_usd>0),0)::text AS "usageRevenueUsd",(SELECT count(*)::int FROM dataset_api_keys WHERE status='active') AS "paidDatasetKeys",(SELECT count(*)::int FROM alert_subscriptions WHERE status='active' AND stripe_subscription_id IS NOT NULL) AS "activeAlerts"`.execute(db)
 ]);
 const trades=ledger.map(r=>r.payload as unknown as ResearchTrade);
 return {generatedAt:new Date().toISOString(),channels,benchmark:market?.quotes.find(q=>q.symbol==="SPY")??null,
 sources:{sec:official?.sources.sec??"error",ted:official?.sources.ted??"error",news:fetched[1].status==="fulfilled"?(news.length?"ok":"empty"):"error",markets:market?"ok":"error"},
 coverage:{...coverage,total:Number(coverage?.total??0),measurementPoints:1,globalOutageConfirmed:false,
 explanation:"Only one observation origin. Target cloud regions are not independent measurement origins. CDN front doors can hide the origin; unknown hosting is retained rather than guessed."},
 validation:validation.rows[0]??null,research:{...forwardResearch.summary(trades),trades:trades.slice(-30).reverse(),job:await mppStore.get("economic:research:lastRun")},
 journal:journal.map(r=>({...r,baseline:r.baseline,outcomes:r.outcomes})),
 supplierExposures:exposures.rows,incidents,execution:await eventExecution.summary(),
 revenue:{...revenue.rows[0],alertsPaymentVerified:false,note:"Usage revenue reflects recorded paid requests. Active keys/subscriptions are not collected subscription revenue; Stripe payment settlement is not audited here."},
 method:"Research candidates from timestamped title matching and curated mechanisms. Market movement does not establish causality or an unpriced opportunity. Lead/lag survivors are statistical associations, not net trading alpha. No live orders or claimed realized trading income."};
}

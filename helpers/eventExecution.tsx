import {db} from "./db";
import {mppStore} from "./mppStore";
import {eventTrading,type Book,type EventSignal} from "./eventTrading";
import {outageEventStudy} from "./outageEventStudy";

// Rule outage-v1 (radar incident -> SHORT the provider's listed parent) was RETIRED on 2026-10-09 with the owner's
// approval: a pre-registered study of 26 historical outages (helpers/outageEventStudy) found no tradable effect.
// New radar incidents are therefore no longer turned into trade hypotheses; existing rows (none) stay as history.
const OUTAGE_RULE_RETIRED = true;

async function json(url:string){
 const r=await fetch(url,{headers:{"user-agent":"ShadowGraph/1.0","cache-control":"no-cache"},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error("Public feed HTTP "+r.status);return r.json();
}
async function book(venue:"Kraken"|"Coinbase",symbol:"BTC/USD"|"ETH/USD"):Promise<Book>{
 const pair=symbol==="BTC/USD"?"XBTUSD":"ETHUSD";
 if(venue==="Kraken"){
  const [depth,status,pairs]=await Promise.all([json("https://api.kraken.com/0/public/Depth?pair="+pair+"&count=20"),json("https://api.kraken.com/0/public/SystemStatus"),json("https://api.kraken.com/0/public/AssetPairs?pair="+pair)]);
  if(depth.error?.length||status.error?.length||pairs.error?.length)throw Error("Kraken feed error");
  const data=Object.values(depth.result??{})[0] as {bids:unknown[][];asks:unknown[][]}|undefined;
  const product=Object.values(pairs.result??{})[0] as {status?:string}|undefined;
  if(!data)throw Error("Kraken empty book");
  return {venue,symbol,currency:"USD",observedAt:new Date().toISOString(),sourceAt:null,trading:status.result?.status==="online"&&product?.status==="online"?"online":"restricted",
   bids:data.bids.map(l=>[Number(l[0]),Number(l[1])]),asks:data.asks.map(l=>[Number(l[0]),Number(l[1])]),feeBps:40,feeVerified:false};
 }
 const product=symbol.replace("/","-");
 const [data,status]=await Promise.all([json("https://api.exchange.coinbase.com/products/"+product+"/book?level=2"),json("https://api.exchange.coinbase.com/products/"+product)]);
 return {venue,symbol,currency:"USD",observedAt:new Date().toISOString(),sourceAt:typeof data.time==="string"?data.time:null,
  trading:status.status==="online"&&!status.trading_disabled&&!status.cancel_only&&!status.post_only&&!status.limit_only&&!data.auction_mode?"online":"restricted",
  bids:(data.bids??[]).slice(0,20).map((l:unknown[])=>[Number(l[0]),Number(l[1])]),asks:(data.asks??[]).slice(0,20).map((l:unknown[])=>[Number(l[0]),Number(l[1])]),feeBps:60,feeVerified:false};
}
async function run(vantageSuspect=false){
 const at=new Date().toISOString();
 if(!vantageSuspect&&!OUTAGE_RULE_RETIRED){
  const incidents=await db.selectFrom("radarIncidents").select(["id","provider","layer","startedAt","affected"]).where("status","=","open").execute();
  for(const candidate of eventTrading.signals(incidents.map(e=>({...e,startedAt:new Date(e.startedAt).toISOString()})),at)){
   await db.insertInto("economicRadarSignals").values({signalId:candidate.signalId,incidentId:candidate.incidentId,firstObservedAt:at,payload:candidate as never}).onConflict(oc=>oc.column("signalId").doNothing()).execute();
  }
 }
 const settled=await Promise.allSettled((["BTC/USD","ETH/USD"] as const).flatMap(symbol=>(["Kraken","Coinbase"] as const).map(venue=>book(venue,symbol))));
 const books=settled.filter((r):r is PromiseFulfilledResult<Book>=>r.status==="fulfilled").map(r=>r.value);
 const now=Date.now();
 const routes=books.flatMap(buy=>books.filter(sell=>sell.symbol===buy.symbol&&sell.venue!==buy.venue).map(sell=>({symbol:buy.symbol,buy:buy.venue,sell:sell.venue,quantity:buy.symbol==="BTC/USD"?0.001:0.01,...eventTrading.arbitrage(buy,sell,buy.symbol==="BTC/USD"?0.001:0.01,now)})));
 const payload={at,books,routes,vantageSuspect,errors:settled.filter(r=>r.status==="rejected").map(r=>String((r as PromiseRejectedResult).reason?.message??"Feed unavailable")),
  method:"REST depth sampled every five minutes. Account fee assumptions are unverified. Pre-funded balances, transfer routes and account trade permissions are required. No cross-exchange orders submitted."};
 await db.insertInto("economicBookSnapshots").values({snapshotId:at,observedAt:at,payload:payload as never}).onConflict(oc=>oc.column("snapshotId").doNothing()).execute();
 await mppStore.put("economic:execution:lastRun",payload);
 // Keep reproducible book history for 90 days; no change to baseline backup tables.
 if(new Date().getUTCMinutes()<5)await db.deleteFrom("economicBookSnapshots").where("observedAt","<",new Date(now-90*86400000)).execute();
 return payload;
}
async function history(){
 const cached=await mppStore.get("economic:outage-backtest:v1") as {at:number;data:unknown}|null;
 if(cached&&Date.now()-cached.at<15*60000)return cached.data as ReturnType<typeof eventTrading.backtest> & {sourceErrors:string[]};
 const rows=await db.selectFrom("economicRadarSignals").select("payload").orderBy("firstObservedAt").limit(2000).execute();
 const signals=rows.map(r=>r.payload as unknown as EventSignal);
 const symbols=[...new Set(signals.map(s=>s.symbol)),"SPY"],errors:string[]=[];
 const prices:Record<string,Array<{at:number;open:number;close:number}>>={};
 if(signals.length){
  const start=Math.floor(Math.min(...signals.map(s=>Date.parse(s.observedAt)))/1000)-86400;
  await Promise.all(symbols.map(async symbol=>{
   try{
    const data=await json("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?period1="+start+"&period2="+Math.floor(Date.now()/1000)+"&interval=1d");
    const r=data.chart?.result?.[0],q=r?.indicators?.quote?.[0];
    if(!r?.timestamp||!q)throw Error("Missing price series");
    prices[symbol]=r.timestamp.map((t:number,i:number)=>({at:t*1000,open:q.open[i],close:q.close[i]}));
   }catch{errors.push(symbol+": historical feed unavailable");}
  }));
 }
 const data={...eventTrading.backtest(signals,prices,Date.now()),sourceErrors:errors};
 await mppStore.put("economic:outage-backtest:v1",{at:Date.now(),data});return data;
}
async function summary(){
 const [signals,lastRun,backtest,snapshotCount,study]=await Promise.all([
  db.selectFrom("economicRadarSignals").selectAll().orderBy("firstObservedAt","desc").limit(30).execute(),
  mppStore.get("economic:execution:lastRun"),history(),
  db.selectFrom("economicBookSnapshots").select(({fn})=>fn.countAll<number>().as("count")).executeTakeFirst(),
  outageEventStudy.get().catch(()=>null)
 ]);
 const latest=lastRun as Awaited<ReturnType<typeof run>>|null;
 const infra=study?.results.infrastructureOnly;
 const outageRule={version:"outage-v1",status:"retired" as const,retiredAt:"2026-10-09",
  reason:"A pre-registered study of major public outages (2011-2025) found no tradable move in the provider's stock. Radar incidents are monitored as infrastructure risk, not traded.",
  study:study?{events:infra?.reactionDay0.events??null,reactionMeanPct:infra?.reactionDay0.meanPct??null,reactionT:infra?.reactionDay0.t??null,
   driftMeanPct:infra?.tradableDrift1to5.meanPct??null,driftT:infra?.tradableDrift1to5.t??null,shortNetMeanPct:infra?.shortNetOfCosts.meanPct??null,
   supported:study.signalSupported,conclusion:study.conclusion,url:"/_api/research/outage_impact"}:null};
 return {signals:signals.map(r=>r.payload as unknown as EventSignal),bookSnapshotCount:Number(snapshotCount?.count??0),lastRun:latest,backtest,
  decision:"RESEARCH_ONLY",liveTradingEnabled:false,outageRule,broker:{provider:"Alpaca",mode:"paper",credentialsConfigured:!!process.env.ALPACA_PAPER_KEY_ID&&!!process.env.ALPACA_PAPER_SECRET_KEY,health:await mppStore.get("economic:broker:health")},
  nextAction:"Outage-driven trading is retired: the historical study did not support it. Crypto order books are still sampled to measure, not trade, cross-venue spreads."};
}
export const eventExecution = {run,history,summary};

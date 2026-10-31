import {db} from "./db";
import {sql} from "kysely";
import {mppStore} from "./mppStore";
import {alphaSnapshot} from "./alphaSnapshot";
import {economicIntelligence} from "./economicIntelligence";
import {forwardResearch,type ResearchTrade} from "./forwardResearch";
import {createHash} from "crypto";
import {paperBroker} from "./paperBroker";
export async function economicResearchJob(){
 const startedAt=new Date().toISOString();const errors:string[]=[];
 // Native scheduler also prevents overlap. Pre-create lock row so row-level locking is meaningful.
 await db.insertInto("mppStore").values({key:"economic:research:lock",value:{at:0}}).onConflict(oc=>oc.column("key").doNothing()).execute();
 const locked=await mppStore.update<boolean>("economic:research:lock",cur=>{
 const at=(cur as {at?:number}|null)?.at??0;
 return Date.now()-at<10*60000?{op:"noop",result:false}:{op:"set",value:{at:Date.now()},result:true};
 });
 if(!locked)return;
 let newEvents=0,tradeCount=0;
 try {
  const results=await Promise.allSettled([alphaSnapshot(),economicIntelligence()]);
  if(results[0].status==="fulfilled"){
   const alpha=results[0].value;
   const openRows=await db.selectFrom("economicResearchTrades").select(["payload"]).where("resolvedAt","is",null).execute();
   const previous=openRows.map(r=>r.payload as unknown as ResearchTrade);
   const exists=await db.selectFrom("economicResearchTrades").select("signalId").where("signalId","=",alpha.setup.signalId).executeTakeFirst();
   const next=forwardResearch.step(previous,exists?null:alpha.setup,alpha.prices,alpha.quoteTimes??{},startedAt);
   for(const t of next){
    const resolved=t.closedAt??null;
    await sql`INSERT INTO economic_research_trades(signal_id,payload,first_observed_at,resolved_at)
     VALUES (${t.signalId},${t as never}::jsonb,${t.createdAt},${resolved})
     ON CONFLICT(signal_id) DO UPDATE SET payload=EXCLUDED.payload,resolved_at=EXCLUDED.resolved_at,updated_at=now()
     WHERE economic_research_trades.resolved_at IS NULL`.execute(db);
   }tradeCount=next.length;
  }else errors.push("alpha: "+String(results[0].reason?.message??results[0].reason).slice(0,120));
  if(results[1].status==="fulfilled"){
   const hub=results[1].value;
   for(const c of hub.channels)for(const event of c.matches){
    const quotes=c.quotes.filter(q=>q.quoteFresh&&q.price!==null&&q.price>0&&q.marketTime!*1000>=Date.parse(event.publishedAt));
    if(!quotes.length)continue;
    const id=createHash("sha256").update(c.id+":"+event.url.replace(/[?#].*$/,"")).digest("hex");
    const inserted=await db.insertInto("economicEventJournal").values({
     eventId:id,channelId:c.id,eventPublishedAt:event.publishedAt,firstObservedAt:startedAt,
     baseline:{event,quoteSource:"Yahoo Finance; may be delayed",pricingStatus:"not_assessed",selection:"predefined exposure basket; direction unverified",quotes:quotes.map(q=>({symbol:q.symbol,price:q.price,marketTime:q.marketTime})),benchmark:hub.benchmark?.marketTime&&Date.now()-hub.benchmark.marketTime*1000<=30*60000?hub.benchmark:null,observedAt:startedAt}
    }).onConflict(oc=>oc.column("eventId").doNothing()).returning("eventId").executeTakeFirst();
    if(inserted)newEvents++;
   }
   const market=new Map(hub.channels.flatMap(c=>c.quotes).map(q=>[q.symbol,q]));
   const rows=await db.selectFrom("economicEventJournal").selectAll().where("firstObservedAt",">",new Date(Date.now()-45*86400000)).execute();
   for(const row of rows){
    const baseline=row.baseline as unknown as {quotes:Array<{symbol:string;price:number;marketTime:number}>;benchmark?:{price:number|null;marketTime:number|null}|null};
    const outcomes={...(row.outcomes as Record<string,unknown>)};
    let changed=false;
    for(const days of [1,5,20]){
     const key=days+"d";if(outcomes[key])continue;
     const deadline=new Date(row.firstObservedAt).getTime()+days*86400000;
     const benchmark=hub.benchmark;
     const benchmarkReturnPct=baseline.benchmark?.price&&benchmark?.price&&benchmark.marketTime&&Date.now()-benchmark.marketTime*1000<=30*60000&&benchmark.marketTime*1000>=deadline?100*(benchmark.price/baseline.benchmark.price-1):null;
     const prices=baseline.quotes.map(b=>{const q=market.get(b.symbol);
      return q?.quoteFresh&&q.price!==null&&q.marketTime!*1000>=deadline?{symbol:b.symbol,price:q.price,quoteAt:new Date(q.marketTime!*1000).toISOString(),returnPct:100*(q.price/b.price-1),excessVsSpyPct:benchmarkReturnPct===null?null:100*(q.price/b.price-1)-benchmarkReturnPct}:null;});
     if(Date.now()>=deadline&&prices.length&&prices.every(q=>q!==null)){
      outcomes[key]={observedAt:startedAt,deadline:new Date(deadline).toISOString(),calendarDays:days,quotes:prices,benchmarkReturnPct,interpretation:"Basket price changes since first system observation, not event-time returns, attribution, trade P&L, or proof of causality"};changed=true;
     }
    }
    if(changed)await db.updateTable("economicEventJournal").set({outcomes:outcomes as never}).where("eventId","=",row.eventId).execute();
   }
  }else errors.push("events: "+String(results[1].reason?.message??results[1].reason).slice(0,120));
  await paperBroker.status();
  await mppStore.put("economic:research:lastRun",{startedAt,finishedAt:new Date().toISOString(),newEvents,tradeCount,errors,mode:"paper_only",intervalMinutes:15});
  await mppStore.delete("economic:hub:en:v3");
 } finally {await mppStore.put("economic:research:lock",{at:0});}
}

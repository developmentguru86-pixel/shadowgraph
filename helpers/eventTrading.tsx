export type RadarEvent = {id:string;provider:string;layer:string;startedAt:string;affected?:unknown};
export type EventSignal = {signalId:string;incidentId:string;symbol:string;direction:"SHORT";observedAt:string;eventAt:string;provider:string;decision:"RESEARCH";ruleVersion:string;reason:string};
export type Book = {venue:string;symbol:string;currency:string;observedAt:string;sourceAt:string|null;trading:"online"|"restricted"|"unknown";bids:number[][];asks:number[][];feeBps:number;feeVerified:boolean};
export type Funding = {usd:number;base:number;verified:boolean;withdrawals:"enabled"|"disabled"|"unknown"};
export type Bar = {at:number;open:number;close:number};
const exposure = [
 {test:/cloudflare/i,symbol:"NET"}, {test:/\baws\b|amazon/i,symbol:"AMZN"},
 {test:/azure|microsoft/i,symbol:"MSFT"},{test:/\bgcp\b|google/i,symbol:"GOOGL"},
 {test:/oracle/i,symbol:"ORCL"},{test:/akamai/i,symbol:"AKAM"}
];
function signals(events:RadarEvent[],observedAt:string):EventSignal[]{
 return events.flatMap(event=>exposure.filter(e=>e.test.test(event.provider)).map(e=>({
  signalId:event.id+":"+e.symbol+":outage-v1",incidentId:event.id,symbol:e.symbol,direction:"SHORT" as const,
  observedAt,eventAt:event.startedAt,provider:event.provider,decision:"RESEARCH" as const,ruleVersion:"outage-v1",
  reason:"Provider exposure mapped to listed parent. Short direction is an unvalidated outage hypothesis; one observation origin does not confirm a global incident."
 })));
}
function fill(levels:number[][],qty:number,ascending:boolean){
 let remaining=qty,value=0;
 const valid=levels.filter(l=>Number.isFinite(l[0])&&l[0]>0&&Number.isFinite(l[1])&&l[1]>0).sort((a,b)=>ascending?a[0]-b[0]:b[0]-a[0]);
 for(const [price,size] of valid){const used=Math.min(remaining,size);value+=used*price;remaining-=used;if(remaining<1e-10)break;}
 return remaining<1e-10?{value,vwap:value/qty}:null;
}
function arbitrage(buy:Book,sell:Book,qty:number,now:number,inventory:Record<string,Funding>={},slippageBps=10,rebalanceUsd=2){
 const blockers:string[]=[];
 if(!Number.isFinite(qty)||qty<=0)return {decision:"BLOCKED" as const,blockers:["Invalid quantity"],netUsd:null,netBps:null,buyVwap:null,sellVwap:null};
 if(buy.venue===sell.venue)blockers.push("Distinct venues required");
 if(buy.symbol!==sell.symbol||buy.currency!==sell.currency)blockers.push("Asset and quote currency must match");
 if(!Number.isFinite(slippageBps)||slippageBps<0||!Number.isFinite(rebalanceUsd)||rebalanceUsd<0)blockers.push("Invalid cost assumptions");
 for(const b of [buy,sell]){
  const at=Date.parse(b.observedAt);
  if(!Number.isFinite(at)||now-at>15000||at>now+1000)blockers.push(b.venue+": stale or invalid observation");
  if(b.sourceAt&&(now-Date.parse(b.sourceAt)>15000||Date.parse(b.sourceAt)>now+1000||!Number.isFinite(Date.parse(b.sourceAt))))blockers.push(b.venue+": stale source timestamp");
  if(b.trading!=="online")blockers.push(b.venue+": trading health not verified");
  if(!b.feeVerified)blockers.push(b.venue+": account fee tier unverified");
  if(!Number.isFinite(b.feeBps)||b.feeBps<0)blockers.push(b.venue+": invalid fee");
  const bestBid=Math.max(...b.bids.map(l=>l[0])),bestAsk=Math.min(...b.asks.map(l=>l[0]));
  if(bestBid>=bestAsk)blockers.push(b.venue+": crossed or locked book");
 }
 const delta=Math.abs(Date.parse(buy.observedAt)-Date.parse(sell.observedAt));
 if(!Number.isFinite(delta)||delta>3000)blockers.push("Snapshots more than 3 seconds apart");
 const purchase=fill(buy.asks,qty,true),sale=fill(sell.bids,qty,false);
 if(!purchase||!sale)blockers.push("Insufficient displayed depth");
 const b=inventory[buy.venue],s=inventory[sell.venue];
 if(!b?.verified||!s?.verified)blockers.push("Pre-funded balances at both venues are unverified");
 if(purchase&&(!b||b.usd<purchase.value*(1+buy.feeBps/10000)))blockers.push("Insufficient buy-side cash");
 if(!s||s.base<qty)blockers.push("Insufficient sell-side asset inventory");
 // A transfer-dependent quote is not executable. Even pre-funded inventory needs a known rebalance route.
 if(b?.withdrawals!=="enabled"||s?.withdrawals!=="enabled")blockers.push("Withdrawal / rebalancing route unavailable or unverified");
 const netUsd=purchase&&sale?sale.value-purchase.value-purchase.value*buy.feeBps/10000-sale.value*sell.feeBps/10000-(purchase.value+sale.value)*slippageBps/10000-rebalanceUsd:null;
 const netBps=netUsd!==null&&purchase?netUsd/purchase.value*10000:null;
 if(netUsd!==null&&netUsd<=0)blockers.push("No positive spread after estimated costs");
 return {decision:blockers.length?"BLOCKED" as const:"PAPER_CANDIDATE" as const,blockers,netUsd,netBps,buyVwap:purchase?.vwap??null,sellVwap:sale?.vwap??null};
}
function backtest(events:EventSignal[],prices:Record<string,Bar[]>,now:number,horizonBars=5,costBpsPerSide=15,borrowAnnualBps=500){
 // Fixed rule, next daily open strictly after the first system observation.
 // Splits chronologically by event time, before filtering for price availability.
 const ordered=[...events].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 const split=Math.floor(ordered.length*0.7), boundary=ordered[split]?Date.parse(ordered[split].observedAt):Infinity;
 const result:Array<{signalId:string;symbol:string;entryAt:number;exitAt:number;grossPct:number;netPct:number;excessVsSpyPct:number|null;partition:string}>=[];
 const occupied=new Map<string,number>();let skipped=0,embargoed=0;
 for(let k=0;k<ordered.length;k++){
  const event=ordered[k],at=Date.parse(event.observedAt);
  const bars=[...(prices[event.symbol]??[])].filter(b=>Number.isFinite(b.at)&&b.open>0&&b.close>0&&Number.isFinite(b.open)&&Number.isFinite(b.close)).sort((a,b)=>a.at-b.at);
  const ix=bars.findIndex(b=>b.at>at),entry=bars[ix],exit=bars[ix+horizonBars-1];
  // Require a complete exit session; daily OHLC of an ongoing session must not leak.
  if(!entry||!exit||exit.at+86400000>now||at<Date.parse(event.eventAt)||horizonBars<1){skipped++;continue;}
  if(entry.at<=(occupied.get(event.symbol)??0)){skipped++;continue;}
  if(k<split&&exit.at+86400000>=boundary){embargoed++;continue;}
  const grossPct=100*(entry.open-exit.close)/entry.open;
  const elapsedDays=(exit.at+86400000-entry.at)/86400000;
  const netPct=grossPct-2*costBpsPerSide/100-borrowAnnualBps/100*elapsedDays/365;
  const bench=prices.SPY??[],be=bench.find(b=>b.at===entry.at),bx=bench.find(b=>b.at===exit.at);
  result.push({signalId:event.signalId,symbol:event.symbol,entryAt:entry.at,exitAt:exit.at+86400000,grossPct,netPct,excessVsSpyPct:be&&bx?netPct-100*(be.open-bx.close)/be.open:null,partition:k<split?"train":"test"});
  occupied.set(event.symbol,exit.at+86400000);
 }
 function stats(rows:typeof result){const returns=rows.map(r=>r.netPct);return {trades:rows.length,netMeanPct:rows.length?returns.reduce((a,b)=>a+b,0)/rows.length:null,winRate:rows.length?returns.filter(r=>r>0).length/rows.length:null};}
 const train=stats(result.filter(r=>r.partition==="train")),test=stats(result.filter(r=>r.partition==="test"));
 return {ruleVersion:"outage-v1",status:test.trades>=30?"sample_available_not_execution_validated":"insufficient_history",events:events.length,skipped,embargoed,train,test,trades:result.slice(-50),costBpsPerSide,borrowAnnualBps,horizonBars,
  limitations:["Daily price proxy, not executable fills","Short borrow availability and actual financing must be verified","Single observation origin; no causal attribution","Fixed provider mapping; no optimized rule selection","No live-trading permission or profit guarantee"]};
}
export const eventTrading = {signals,fill,arbitrage,backtest};

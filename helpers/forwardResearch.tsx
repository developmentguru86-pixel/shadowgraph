import type { AlphaSetup } from "../endpoints/alpha_GET.schema";
export type ResearchTrade = {
 signalId:string; instrument:string; direction:"LONG"|"SHORT"; score:number;
 state:"ARMED"|"ACTIVE"|"TARGET HIT"|"STOPPED"|"EXPIRED"|"INVALIDATED";
 createdAt:string; lastObservedAt?:string; activatedAt?:string; closedAt?:string;
 trigger:number; entry:number|null; stop:number; target:number; closePrice?:number;
 grossR?:number; netR?:number; costBpsPerSide:number; model:"sampled-quotes-v1";
};
const open=(t:ResearchTrade)=>t.state==="ARMED"||t.state==="ACTIVE";
const qualifies=(s:AlphaSetup)=> (s.direction==="LONG"||s.direction==="SHORT") && (s.state==="ARMED"||s.state==="ACTIVE") && s.confidence>=75 && s.rewardRisk!==null && s.rewardRisk>=2
 && [s.trigger,s.stop,s.target2].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0)
 && (s.direction==="LONG" ? s.stop!<s.trigger!&&s.trigger!<s.target2! : s.stop!>s.trigger!&&s.trigger!>s.target2!);
function finish(t:ResearchTrade,state:ResearchTrade["state"],now:string,price:number):ResearchTrade{
 if(t.entry===null)return {...t,state,closedAt:now};
 const sign=t.direction==="LONG"?1:-1,risk=Math.abs(t.entry-t.stop);
 const grossR=sign*(price-t.entry)/risk;
 const costs=(t.entry+price)*t.costBpsPerSide/10000/risk;
 return {...t,state,closedAt:now,closePrice:price,grossR,netR:grossR-costs};
}
function step(previous:ResearchTrade[],setup:AlphaSetup|null,quotes:Record<string,number>,times:Record<string,string>,now:string){
 const nowMs=Date.parse(now);if(!Number.isFinite(nowMs))throw Error("Invalid evaluation time");
 const trades=previous.map(t=>({...t}));
 if(setup&&qualifies(setup)&&!trades.some(t=>t.signalId===setup.signalId)&&!trades.some(t=>t.instrument===setup.instrument&&open(t))){
  trades.push({signalId:setup.signalId,instrument:setup.instrument,direction:setup.direction as "LONG"|"SHORT",score:setup.confidence,state:"ARMED",createdAt:now,trigger:setup.trigger!,entry:null,stop:setup.stop!,target:setup.target2!,costBpsPerSide:10,model:"sampled-quotes-v1"});
 }
 return trades.map(t=>{
  if(!open(t))return t;
  const time=Date.parse(times[t.instrument]??""),price=quotes[t.instrument];
  const fresh=Number.isFinite(time)&&time<=nowMs+60000&&nowMs-time<=30*60000&&time>Date.parse(t.lastObservedAt??t.createdAt)&&Number.isFinite(price)&&price>0;
  if(t.state==="ARMED"&&nowMs-Date.parse(t.createdAt)>=6*3600000)return {...t,state:"INVALIDATED" as const,closedAt:now};
  if(!fresh)return t;
  t.lastObservedAt=times[t.instrument];
  const long=t.direction==="LONG";
  const stopHit=long?price<=t.stop:price>=t.stop;
  const targetHit=long?price>=t.target:price<=t.target;
  if(t.state==="ARMED"){
   if(stopHit||targetHit)return {...t,state:"INVALIDATED" as const,closedAt:now};
   const crossed=long?price>=t.trigger:price<=t.trigger;
   if(!crossed)return t;
   const rr=Math.abs(t.target-price)/Math.abs(price-t.stop);
   if(rr<1.5)return {...t,state:"INVALIDATED" as const,closedAt:now};
   return {...t,state:"ACTIVE" as const,entry:price,activatedAt:now};
  }
  if(stopHit)return finish(t,"STOPPED",now,price);
  if(targetHit)return finish(t,"TARGET HIT",now,t.target);
  if(nowMs-Date.parse(t.activatedAt??t.createdAt)>=24*3600000)return finish(t,"EXPIRED",now,price);
  return t;
 });
}
function summary(trades:ResearchTrade[]){
 const closed=trades.filter(t=>t.netR!==undefined).sort((a,b)=>Date.parse(a.closedAt!)-Date.parse(b.closedAt!));
 const n=closed.length,wins=closed.filter(t=>t.netR!>0).length;
 const p=n?wins/n:0,z=1.96,d=1+z*z/Math.max(n,1),center=(p+z*z/(2*Math.max(n,1)))/d;
 const half=z*Math.sqrt((p*(1-p)+z*z/(4*Math.max(n,1)))/Math.max(n,1))/d;
 let cumulative=0,peak=0,maxDrawdownR=0;
 for(const t of closed){cumulative+=t.netR!;peak=Math.max(peak,cumulative);maxDrawdownR=Math.min(maxDrawdownR,cumulative-peak);}
 const gains=closed.reduce((s,t)=>s+Math.max(0,t.netR!),0),losses=-closed.reduce((s,t)=>s+Math.min(0,t.netR!),0);
 return {resolved:n,open:trades.filter(open).length,invalidated:trades.filter(t=>t.state==="INVALIDATED").length,
 winRate:n?p*100:null,winRateInterval:n?[Math.max(0,center-half)*100,Math.min(1,center+half)*100]:null,
 netR:cumulative,avgNetR:n?cumulative/n:null,maxDrawdownR,profitFactor:losses?gains/losses:null,
 validationStatus:"not_validated" as const,
 scoreBands:[75,85,95].map(low=>{const rows=closed.filter(t=>t.score>=low&&t.score<(low===95?101:low+10));return {low,n:rows.length,observedWinRate:rows.length?100*rows.filter(t=>t.netR!>0).length/rows.length:null};}),
 costAssumption:"10 bps per side: assumed fee + slippage; financing excluded",
 limitations:"15-minute sampled quotes; missed intrabar stops/targets and execution uncertainty. Observational paper results, not executable fills, calibrated probabilities, or proof of alpha."};
}
export const forwardResearch={step,summary,qualifies};

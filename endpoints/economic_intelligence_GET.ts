import {economicIntelligence} from "../helpers/economicIntelligence";
import {PUBLISH_MARKET_QUOTES,PUBLISH_NEWS_HEADLINES,WITHHELD,withoutNews} from "../helpers/licensing";

// The internal research job uses economicIntelligence() with full inputs; only this public view withholds unlicensed prices and headlines.
export async function handle(){
 try{
  const data=await economicIntelligence();
  const out={...data,
   channels:data.channels.map(c=>({...c,matches:withoutNews(c.matches),quotes:PUBLISH_MARKET_QUOTES?c.quotes:[]})),
   benchmark:PUBLISH_MARKET_QUOTES?data.benchmark:null,
   // journal rows keep timing, channel and outcomes; raw quotes and third-party headline text stay internal
   journal:data.journal.map(r=>{
    const b=(r.baseline??{}) as Record<string,unknown>;const ev=(b.event??null) as Record<string,unknown>|null;
    const event=ev&&ev.kind==="news"&&!PUBLISH_NEWS_HEADLINES?{id:ev.id,kind:"news",source:ev.source,publishedAt:ev.publishedAt,title:"Headline withheld (unlicensed source)"}:ev;
    const {quotes:_q,benchmark:_b,...rest}=b;
    const outcomes=PUBLISH_MARKET_QUOTES?r.outcomes:Object.fromEntries(Object.entries((r.outcomes??{}) as Record<string,unknown>).map(([h,o])=>{
     if(!o||typeof o!=="object")return [h,o];
     const {quotes:_oq,benchmark:_ob,...keep}=o as Record<string,unknown>;return [h,keep];
    }));
    return {...r,outcomes,baseline:PUBLISH_MARKET_QUOTES?{...b,event}:{...rest,event,quoteSource:"withheld"}};
   }),
   sources:{...data.sources,news:PUBLISH_NEWS_HEADLINES?data.sources.news:"withheld",markets:PUBLISH_MARKET_QUOTES?data.sources.markets:"withheld"},
   notices:[...(PUBLISH_MARKET_QUOTES?[]:[WITHHELD.quotes]),...(PUBLISH_NEWS_HEADLINES?[]:[WITHHELD.news])]};
  return Response.json(out,{headers:{"Cache-Control":"public, s-maxage=60"}});
 }
 catch(e){console.error("Economic intelligence unavailable",e);return Response.json({error:"Economic intelligence unavailable; retry shortly"},{status:503});}
}
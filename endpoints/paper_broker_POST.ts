import {createHmac,createHash,timingSafeEqual} from "crypto";
import {z} from "zod";
import {getMppSecret,mppStore} from "../helpers/mppStore";
import {paperBroker} from "../helpers/paperBroker";
const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("status")}),
 z.object({action:z.literal("kill"),enabled:z.boolean()}),
 z.object({action:z.literal("submit"),intent:z.object({id:z.string(),symbol:z.enum(["BTC/USD","ETH/USD"]),side:z.enum(["buy","sell"]),qty:z.number(),limitPrice:z.number()})}),
 z.object({action:z.literal("reconcile"),clientOrderId:z.string()}),
 z.object({action:z.literal("cancel"),clientOrderId:z.string()})
]);
export async function handle(request:Request){
 const at=request.headers.get("x-shadowgraph-at")??"",signature=request.headers.get("x-shadowgraph-signature")??"";
 if(!/^\d{13}$/.test(at)||Math.abs(Date.now()-Number(at))>60000||!/^[a-f0-9]{64}$/.test(signature))return Response.json({error:"Unauthorized"},{status:401});
 const body=await request.text();if(body.length>4096)return Response.json({error:"Request too large"},{status:400});
 const digest=createHash("sha256").update(body).digest("hex");
 const expected=createHmac("sha256",await getMppSecret()).update("shadowgraph:paper-broker:"+at+":"+digest).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature,"hex")))return Response.json({error:"Unauthorized"},{status:401});
 let parsed;try{parsed=input.parse(JSON.parse(body));}catch{return Response.json({error:"Invalid broker request"},{status:400});}
 const key="economic:broker:nonce:"+signature;
 const seeded=await mppStore.get(key);if(seeded)return Response.json({error:"Request already consumed"},{status:409});
 // Atomic nonce consumption; duplicate signed mutations cannot execute twice.
 const {db}=await import("../helpers/db");
 const reserved=await db.insertInto("mppStore").values({key,value:{at:Number(at)}}).onConflict(oc=>oc.column("key").doNothing()).returning("key").executeTakeFirst();
 if(!reserved)return Response.json({error:"Request already consumed"},{status:409});
 try{
  let result;
  if(parsed.action==="status")result=await paperBroker.status();
  else if(parsed.action==="kill")result=await paperBroker.setKill(parsed.enabled);
  else if(parsed.action==="submit")result=await paperBroker.submit(parsed.intent);
  else if(parsed.action==="cancel")result=await paperBroker.cancel(parsed.clientOrderId);
  else result=await paperBroker.reconcile(parsed.clientOrderId);
  return Response.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:"Paper broker unavailable"},{status:409});}
}

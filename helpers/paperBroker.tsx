import {createHash} from "crypto";
import {sql} from "kysely";
import {db} from "./db";
import {mppStore} from "./mppStore";
type Intent={id:string;symbol:"BTC/USD"|"ETH/USD";side:"buy"|"sell";qty:number;limitPrice:number};
const ORIGIN="https://paper-api.alpaca.markets";
function headers(){
 const key=process.env.ALPACA_PAPER_KEY_ID,secret=process.env.ALPACA_PAPER_SECRET_KEY;
 if(!key||!secret)throw Error("Paper broker credentials are not connected");
 return {"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,"Content-Type":"application/json"};
}
async function call(path:string,method="GET",body?:unknown){
 const r=await fetch(ORIGIN+path,{method,headers:headers(),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(r.status===404)return null;
 if(!r.ok)throw Error("Paper broker returned HTTP "+r.status);
 if(r.status===204)return {};
 return r.json();
}
async function status(){
 const configured=!!process.env.ALPACA_PAPER_KEY_ID&&!!process.env.ALPACA_PAPER_SECRET_KEY;
 const switchValue=await mppStore.get("economic:broker:kill");
 const killed=switchValue!==false;
 if(!configured)return {provider:"Alpaca",mode:"paper",connected:false,killed,liveEnabled:false,error:"Credentials missing"};
 try{
  const account=await call("/v2/account");
  const connected=account?.status==="ACTIVE"&&!account.trading_blocked&&!account.account_blocked;
  const result={provider:"Alpaca",mode:"paper",connected,killed,liveEnabled:false,error:connected?null:"Account inactive or blocked"};
  await mppStore.put("economic:broker:health",{at:new Date().toISOString(),...result});return result;
 }catch(e){
  const result={provider:"Alpaca",mode:"paper",connected:false,killed,liveEnabled:false,error:e instanceof Error?e.message:"Broker unavailable"};
  await mppStore.put("economic:broker:health",{at:new Date().toISOString(),...result});return result;
 }
}
async function submit(intent:Intent){
 if(!/^[a-zA-Z0-9_-]{8,80}$/.test(intent.id)||!["BTC/USD","ETH/USD"].includes(intent.symbol)||!["buy","sell"].includes(intent.side))throw Error("Invalid order intent");
 const notional=intent.qty*intent.limitPrice;
 if(!Number.isFinite(intent.qty)||intent.qty<=0||!Number.isFinite(intent.limitPrice)||intent.limitPrice<=0||!Number.isFinite(notional)||notional<1||notional>50)throw Error("Paper order must be between $1 and $50");
 const clientOrderId="sg-paper-"+createHash("sha256").update(intent.id).digest("hex").slice(0,40);
 const prior=await db.selectFrom("economicBrokerOrders").selectAll().where("clientOrderId","=",clientOrderId).executeTakeFirst();
 if(prior){
  const saved=(prior.payload as unknown as {intent:Intent}).intent;
  if(JSON.stringify(saved)!==JSON.stringify(intent))throw Error("Order identifier already belongs to a different intent");
  return reconcile(clientOrderId); // no second POST, even after an ambiguous timeout
 }
 const health=await status();if(!health.connected||health.killed)throw Error("Paper broker unavailable or kill switch enabled");
 const account=await call("/v2/account");
 if(intent.side==="buy"&&Number(account.cash)<notional*1.02)throw Error("Insufficient paper cash");
 if(intent.side==="sell"){
  const position=await call("/v2/positions/"+encodeURIComponent(intent.symbol.replace("/","")));
  if(!position||Number(position.qty_available??position.qty)<intent.qty)throw Error("No short selling; insufficient paper position");
 }
 const quoteResponse=await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols="+encodeURIComponent(intent.symbol),{headers:headers(),signal:AbortSignal.timeout(8000)});
 if(!quoteResponse.ok)throw Error("Executable broker quote unavailable");
 const quote=(await quoteResponse.json())?.quotes?.[intent.symbol],quoteAt=Date.parse(quote?.t??"");
 const reference=Number(intent.side==="buy"?quote?.ap:quote?.bp);
 if(!Number.isFinite(quoteAt)||Date.now()-quoteAt>15000||quoteAt>Date.now()+1000||!Number.isFinite(reference)||reference<=0||Math.abs(intent.limitPrice/reference-1)>0.005)throw Error("Stale quote or limit price more than 0.5% from current broker market");
 const asset=await call("/v2/assets/"+encodeURIComponent(intent.symbol));
 if(!asset?.tradable||asset.status!=="active")throw Error("Asset not tradable");
 const request={symbol:intent.symbol,side:intent.side,qty:String(intent.qty),type:"limit",limit_price:String(intent.limitPrice),time_in_force:"ioc",client_order_id:clientOrderId};
 // Serialize budget, intent reservation and kill switch checks before network submission.
 await db.transaction().execute(async trx=>{
  await sql`SELECT pg_advisory_xact_lock(68432109)`.execute(trx);
  const kill=await trx.selectFrom("mppStore").select("value").where("key","=","economic:broker:kill").executeTakeFirst();
  if(kill?.value!==false)throw Error("Kill switch enabled");
  const usage=await sql<{total:number}>`SELECT COALESCE(sum(notional_usd),0)::float AS total FROM economic_broker_orders WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.execute(trx);
  if(Number(usage.rows[0]?.total??0)+notional>150)throw Error("Daily paper order budget of $150 exceeded");
  await trx.insertInto("economicBrokerOrders").values({clientOrderId,state:"reserved",notionalUsd:notional,payload:{intent,request} as never}).execute();
 });
 // A second check narrows the race with a newly enabled kill switch.
 if(await mppStore.get("economic:broker:kill")!==false){
  await db.updateTable("economicBrokerOrders").set({state:"blocked",updatedAt:new Date()}).where("clientOrderId","=",clientOrderId).execute();throw Error("Kill switch enabled");
 }
 try{
  const order=await call("/v2/orders","POST",request);
  await db.updateTable("economicBrokerOrders").set({state:order?.status??"unknown",updatedAt:new Date(),payload:{intent,request,order} as never}).where("clientOrderId","=",clientOrderId).execute();
 }catch{
  await db.updateTable("economicBrokerOrders").set({state:"unknown",updatedAt:new Date()}).where("clientOrderId","=",clientOrderId).execute();
 }
 return reconcile(clientOrderId);
}
async function reconcile(clientOrderId:string){
 if(!/^sg-paper-[a-f0-9]{40}$/.test(clientOrderId))throw Error("Invalid order identifier");
 const stored=await db.selectFrom("economicBrokerOrders").selectAll().where("clientOrderId","=",clientOrderId).executeTakeFirst();
 if(!stored)throw Error("Order not found");
 const order=await call("/v2/orders:by_client_order_id?client_order_id="+encodeURIComponent(clientOrderId));
 if(!order)return {clientOrderId,state:stored.state,mode:"paper",note:"No confirmed broker order. Unknown submissions require reconciliation; never retry blindly."};
 await db.updateTable("economicBrokerOrders").set({state:order.status,updatedAt:new Date(),payload:{...(stored.payload as Record<string,unknown>),order} as never}).where("clientOrderId","=",clientOrderId).execute();
 return {clientOrderId,brokerOrderId:order.id,state:order.status,filledQty:order.filled_qty,filledAveragePrice:order.filled_avg_price,mode:"paper"};
}
async function cancel(clientOrderId:string){
 const order=await reconcile(clientOrderId);
 if("brokerOrderId" in order&&order.brokerOrderId)await call("/v2/orders/"+encodeURIComponent(order.brokerOrderId),"DELETE");
 return reconcile(clientOrderId);
}
async function setKill(enabled:boolean){
 await mppStore.put("economic:broker:kill",enabled);
 return {killed:enabled,liveEnabled:false,note:enabled?"New submissions blocked. Existing orders are reconciled/cancelled separately.":"Paper submissions enabled within fixed limits; live routing is disabled."};
}
export const paperBroker={status,submit,reconcile,cancel,setKill};

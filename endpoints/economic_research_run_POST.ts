import {createHmac,timingSafeEqual} from "crypto";
import {getMppSecret,mppStore} from "../helpers/mppStore";
import {economicResearchJob} from "../helpers/economicResearchJob";
import {backupExport} from "../helpers/backupExport";
import {eventExecution} from "../helpers/eventExecution";
import {paperBroker} from "../helpers/paperBroker";
export async function handle(request:Request){
 const at=request.headers.get("x-shadowgraph-at")??"",signature=request.headers.get("x-shadowgraph-signature")??"";
 if(!/^\d{13}$/.test(at)||Math.abs(Date.now()-Number(at))>60000||!/^[a-f0-9]{64}$/.test(signature))return Response.json({error:"Unauthorized"},{status:401});
 const operation=request.headers.get("x-shadowgraph-operation")??"research-run";
 if(operation!=="research-run"&&operation!=="backup-export"&&operation!=="execution-run")return Response.json({error:"Unknown operation"},{status:400});
 const expected=createHmac("sha256",await getMppSecret()).update("shadowgraph:"+operation+":"+at).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature,"hex")))return Response.json({error:"Unauthorized"},{status:401});
 if(operation==="backup-export")return Response.json(await backupExport());
 if(operation==="execution-run")return Response.json({execution:await eventExecution.run(),broker:await paperBroker.status()});
 const last=await mppStore.get("economic:research:lastRun") as {startedAt?:string}|null;
 if(last?.startedAt&&Date.now()-Date.parse(last.startedAt)<14*60000)return Response.json({status:"recent_run",lastRun:last});
 await economicResearchJob();return Response.json({status:"complete",lastRun:await mppStore.get("economic:research:lastRun")});
}
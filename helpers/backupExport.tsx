import postgres from "postgres";
import {gzipSync,gunzipSync} from "zlib";
import {createHash} from "crypto";
import {upload,getUrl,getInfo} from "@runtime/storage";
export async function backupExport(){
 const sql=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
 const files:Array<{table:string;filename:string;rows:number;sha256:string;bytes:number}>=[];
 try{
  const inventory=await sql`SELECT table_name,snapshot_at,jsonb_array_length(snapshot_rows) AS row_count FROM shadowgraph_backup_20261009 ORDER BY table_name`;
  for(const item of inventory){
   const filename="backups/2026-10-09-before-improvements/"+item.table_name+".json.gz";
   const existing=await getInfo({visibility:"private",filename});
   if(existing.ok&&existing.exists){
    const read=await getUrl({visibility:"private",filename});
    if(!read.ok)throw Error("Cannot verify existing backup");
    const r=await fetch(read.url),b=Buffer.from(await r.arrayBuffer());const parsed=JSON.parse(gunzipSync(b).toString());
    if(parsed.table!==item.table_name||parsed.rows.length!==item.row_count)throw Error("Existing backup integrity mismatch");
    files.push({table:item.table_name,filename,rows:item.row_count,sha256:createHash("sha256").update(b).digest("hex"),bytes:b.length});continue;
   }
   const [row]=await sql`SELECT snapshot_rows FROM shadowgraph_backup_20261009 WHERE table_name=${item.table_name}`;
   const bytes=gzipSync(Buffer.from(JSON.stringify({table:item.table_name,snapshotAt:item.snapshot_at,rows:row.snapshot_rows})));
   const sha256=createHash("sha256").update(bytes).digest("hex");
   const target=await upload({visibility:"private",filename,sizeBytes:bytes.length,contentType:"application/gzip",ifAbsent:true});
   if(!target.ok)throw Error("Backup upload allocation failed: "+target.error.code);
   const put=await fetch(target.presignedUrl,{method:"PUT",headers:target.headers,body:bytes as unknown as BodyInit});
   if(!put.ok)throw Error("Backup upload failed: "+put.status);
   const read=await getUrl({visibility:"private",filename});if(!read.ok)throw Error("Backup verification URL failed");
   const verify=await fetch(read.url);const downloaded=Buffer.from(await verify.arrayBuffer());
   if(!verify.ok||createHash("sha256").update(downloaded).digest("hex")!==sha256)throw Error("Backup integrity verification failed");
   files.push({table:item.table_name,filename,rows:item.row_count,sha256,bytes:bytes.length});
  }
  const columns=await sql`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name IN (SELECT table_name FROM shadowgraph_backup_20261009) ORDER BY table_name,ordinal_position`;
  const indexes=await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (SELECT table_name FROM shadowgraph_backup_20261009)`;
  const constraints=await sql`SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON con.conrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relname IN (SELECT table_name FROM shadowgraph_backup_20261009)`;
  const enums=await sql`SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON t.typnamespace=n.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`;
  const manifest={version:1,snapshotAt:inventory[0].snapshot_at,checkpointId:"5004e897-f69e-4069-9d03-af5dc298789b",files,columns,indexes,constraints,enums,totalRows:files.reduce((s,f)=>s+f.rows,0)};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2));
  const target=await upload({visibility:"private",filename:"backups/2026-10-09-before-improvements/manifest.json",sizeBytes:bytes.length,contentType:"application/json"});
  if(!target.ok)throw Error("Manifest upload allocation failed");
  const put=await fetch(target.presignedUrl,{method:"PUT",headers:target.headers,body:bytes as unknown as BodyInit});if(!put.ok)throw Error("Manifest upload failed");
  return {verified:true,snapshotAt:manifest.snapshotAt,tableCount:files.length,totalRows:manifest.totalRows,compressedBytes:files.reduce((s,f)=>s+f.bytes,0),folder:"private/backups/2026-10-09-before-improvements/"};
 }finally{await sql.end();}
}

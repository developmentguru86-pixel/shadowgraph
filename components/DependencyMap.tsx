import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network, RefreshCw, ExternalLink, GitBranch, ShieldCheck, Search } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { getDependencyMap } from "../endpoints/dependency_map_GET.schema";
import { dependencyAtlas } from "../helpers/dependencyAtlas";
import styles from "./DependencyMap.module.css";

export const DependencyMap = () => {
 const [selected,setSelected] = useState("ai-power");
 const [search,setSearch] = useState("");
 const [step,setStep] = useState(0);
 const [scenario,setScenario] = useState(false);
 const query = useQuery({queryKey:["dependency-map-en-v2"],queryFn:getDependencyMap,staleTime:300000,retry:1,refetchOnWindowFocus:false});
 const channels = query.data?.channels ?? dependencyAtlas.analyze([]);
 const filtered = useMemo(()=>channels.filter(c=>!search.trim() || (scenario?dependencyAtlas.matching(search,c):[c.title,c.layer,...c.terms,...c.matches.map(e=>e.title)].join(" ").toLocaleLowerCase("en-US").includes(search.toLocaleLowerCase("en-US")))),[channels,search,scenario]);
 const channel = filtered.find(c=>c.id===selected) ?? filtered[0];
 const stages = channel?.stages ?? [];
 const detail = stages[step] ?? stages[0];
 const select = (id:string)=>{setSelected(id);setStep(0)};
 const exportMap = ()=>{
  const blob = new Blob([JSON.stringify({exportedAt:new Date().toISOString(),sourceSnapshot:query.data?.generatedAt??null,scenario:scenario?search:null,channel},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="shadowgraph-dependency.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <section className={styles.workspace} id="dependency-map" lang="en">
  <div className={styles.heading}>
   <div><span className={styles.eyebrow}><Network size={16}/> ECONOMIC DEPENDENCY ATLAS</span><h1>See the system behind the event.</h1><p>Trace infrastructure, capital and supply relationships through second- and third-order effects.</p></div>
   <Button variant="outline" onClick={()=>query.refetch()} disabled={query.isFetching}><RefreshCw size={15}/> {query.isFetching?"Loading sources":"Refresh sources"}</Button>
  </div>
  <div className={styles.status} aria-live="polite">
   <span><b>{channels.length}</b> transmission models</span>
   <span><b>{query.data?channels.reduce((n,c)=>n+c.matches.length,0):"—"}</b> title matches</span>
   <span><b>Hypothesis</b> awaiting verification</span>
   <span>{query.data ? "Retrieved: "+new Date(query.data.generatedAt).toLocaleString("en-US") : "Source-backed models ready · loading current events"}</span>
  </div>
  {query.isError && <div className={styles.notice} role="alert">The current feed is unavailable. Source-backed models remain available; no new event has been verified. Refresh to retry.</div>}
  <div className={styles.toolbar}>
   <label className={styles.search}><Search size={16}/><Input aria-label={scenario?"Scenario text":"Search relationships or events"} placeholder={scenario?"Example: A new data-center investment was delayed":"Search relationships or events: dollar, freight, data centers…"} value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <Button variant={scenario?"primary":"outline"} onClick={()=>{setScenario(!scenario);setSearch("")}} aria-pressed={scenario}>Test a scenario</Button>
  </div>
  {scenario && <p className={styles.notice}>Scenario mode selects relevant transmission models from your text. It is not recorded as an observed event or directional forecast. Compare your assumptions with the model below.</p>}
  <div className={styles.layout}>
   <aside className={styles.sidebar} aria-label="Transmission models">
    <span className={styles.label}>SELECT A RELATIONSHIP</span>
    {filtered.map((c,i)=><Button key={c.id} className={styles.channel} variant={channel?.id===c.id?"secondary":"ghost"} onClick={()=>select(c.id)} aria-pressed={channel?.id===c.id}>
     <span className={styles.number}>0{i+1}</span><span><small>{c.layer}</small><strong>{c.title}</strong><small>{query.data?c.matches.length+" recent candidate headlines":"Model · awaiting event feed"}</small></span>
    </Button>)}
    {!filtered.length && <p>No model matches this text. Try a broader term.</p>}
    <div className={styles.boundary}><ShieldCheck size={18}/><p>A plausible relationship does not establish that it is active today or unpriced by the market.</p></div>
   </aside>
   {channel && <div className={styles.main}>
    <div className={styles.mapHeader}><div><span className={styles.label}>CONDITIONAL IMPACT MAP</span><h2>{channel.title}</h2></div><Button variant="ghost" size="sm" onClick={exportMap}>Export JSON</Button></div>
    <div className={styles.trigger}><GitBranch size={19}/><div><small>TRIGGER CONDITION · UNVERIFIED</small><strong>{channel.trigger}</strong></div></div>
    <div className={styles.stages}>
     {stages.map((s,i)=><div key={s.name} className={styles.stageWrap}><Button variant="outline" className={styles.stage} data-active={step===i} onClick={()=>setStep(i)} aria-pressed={step===i}><small>{i+1}. ORDER</small><strong>{s.name}</strong><span>Conditional transmission</span></Button>{i<stages.length-1 && <span className={styles.connector} aria-hidden="true">→</span>}</div>)}
    </div>
    <div className={styles.branches}><article><small>POTENTIAL RELATIVE ADVANTAGE</small><p>{channel.upside}</p></article><article><small>POTENTIAL PRESSURE</small><p>{channel.downside}</p></article></div>
    {detail && <article className={styles.detail}><span className={styles.label}>SELECTED LINK · {step+1}. ORDER</span><h3>{detail.name}</h3><p>{detail.mechanism}</p><dl><div><dt>Metric to monitor</dt><dd>{detail.metric}</dd></div><div><dt>Impact horizon</dt><dd>{detail.horizon}</dd></div><div><dt>Evidence status</dt><dd>Source-backed general mechanism; event-specific transmission is unverified.</dd></div><div><dt>Pricing</dt><dd>Not assessed · no trade signal generated</dd></div></dl></article>}
    <div className={styles.counter}><article><h3>What invalidates it?</h3><p>{channel.invalidation}</p></article><article><h3>Alternative explanation</h3><p>{channel.alternative}</p></article></div>
    <div className={styles.evidence}><h3>Evidence desk</h3><a href={channel.source.url} target="_blank" rel="noreferrer"><ShieldCheck size={17}/><span><b>{channel.source.title}</b><small>{channel.source.year} · General mechanism source · not confirmation of today’s event</small></span><ExternalLink size={14}/></a>
     <span className={styles.label}>LAST 30 DAYS · TITLE MATCHES</span>
     <p className={styles.muted}>{channel.reason}</p>
     {channel.matches.map(e=><a href={/^https?:\/\//.test(e.url)?e.url:undefined} target="_blank" rel="noreferrer" key={e.id}><span><b>{e.title}</b><small>{e.source} · {e.publishedAt} · {e.kind==="news"?"News":e.kind==="filing"?"Company filing":"Procurement notice"}</small></span><ExternalLink size={14}/></a>)}
     {!channel.matches.length && <p className={styles.notice}>{query.isFetching?"Loading event feed…":"No recent dated title matches were found. This model remains a research hypothesis to monitor."}</p>}
    </div>
   </div>}
  </div>
  <details className={styles.coverage}><summary>Coverage and methodology</summary><p>{query.data?.coverage ?? "Four source-backed mechanism models. Awaiting current source feeds."}</p><p>Connections are editorial economic models. Titles are matched by keywords, without full-document analysis. Sector relevance does not identify the contract winner. Scores are not calibrated probabilities or claims of automatic profit.</p>{query.data && <p>Source responses: {Object.entries(query.data.sources).map(([k,v])=>k.toUpperCase()+": "+v).join(" · ")}. A successful response does not guarantee complete coverage.</p>}</details>
 </section>;
};
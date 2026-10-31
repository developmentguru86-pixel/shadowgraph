import {useEffect,useState} from "react";
import {ArrowRight,Check,ChevronRight,Clock3,Database,LockKeyhole,RadioTower,RefreshCw,ShieldCheck} from "lucide-react";
import {Button} from "./Button";
import {Tabs,TabsContent,TabsList,TabsTrigger} from "./Tabs";
import type {OutputType} from "../endpoints/event_execution_GET.schema";
import styles from "./EventResearch.module.css";

const money=(n:number|null|undefined)=>typeof n==="number"&&Number.isFinite(n)?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n):"—";
const pct=(n:number|null|undefined)=>typeof n==="number"&&Number.isFinite(n)?(n>=0?"+":"")+n.toFixed(2)+"%":"—";
const stamp=(v:string|undefined)=>v?new Date(v).toLocaleString("en-US",{month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC":"Awaiting observation";
type Props={data:OutputType|undefined;loading:boolean;error:boolean;refreshing:boolean;onRefresh:()=>void};
export function EventResearch({data,loading,error,refreshing,onRefresh}:Props){
 const [routeKey,setRouteKey]=useState("");
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(id);},[]);
 const routes=data?.lastRun?.routes??[];
 const routeId=(r:typeof routes[number])=>r.symbol+":"+r.buy+":"+r.sell;
 const selected=routes.find(r=>routeId(r)===routeKey)??routes[0];
 const books=data?.lastRun?.books??[];
 const health=data?.broker.health as {connected?:boolean;error?:string;killed?:boolean;at?:string}|null|undefined;
 const healthFresh=!!health?.at&&now-Date.parse(health.at)<20*60000;
 const connected=health?.connected&&healthFresh;
 const snapshotFresh=!!data?.lastRun?.at&&now-Date.parse(data.lastRun.at)<=15000;
 const tests=data?.backtest;
 const gates=selected?[
  {label:"Matching market",detail:selected.symbol+" · USD",pass:true},
  {label:"Market-data freshness",detail:snapshotFresh?"Within the 15-second execution window":"Historical snapshot · refresh required before any order",pass:snapshotFresh},
  {label:"Net spread after costs",detail:money(selected.netUsd)+" at "+selected.quantity+" units",pass:selected.netUsd!==null&&selected.netUsd>0},
  {label:"Fees & funded balances",detail:"Account-level verification required",pass:false},
  {label:"Transfer & rebalance route",detail:"Withdrawal availability not verified",pass:false}
 ]:[];
 return <section id="event-signals" className={styles.section} aria-labelledby="event-research-title">
  <header className={styles.heading}>
   <div><span className={styles.eyebrow}>Economic intelligence / Decision research</span><h2 id="event-research-title">From disruption<br/><em>to a decision.</em></h2><p>Trace infrastructure events into market exposure. Inspect the evidence, measure the costs, and test what remains.</p></div>
   <div className={styles.headingAside}><span className={styles.mode}><LockKeyhole size={13}/>Research & paper environment</span><Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} className={refreshing?styles.spin:undefined}/>Refresh observations</Button><small>{stamp(data?.lastRun?.at)}</small></div>
  </header>
  <div className={styles.metrics} aria-label="Research coverage">
   <div><span>Recent signals</span><b>{data?data.signals.length:"—"}</b><small>Infrastructure → listed exposure</small></div>
   <div><span>Market feeds</span><b>{data?books.length:"—"}<i> / 4</i></b><small>Kraken · Coinbase / BTC · ETH</small></div>
   <div><span>Archived snapshots</span><b>{data?data.bookSnapshotCount.toLocaleString("en-US"):"—"}</b><small>Timestamped order-book observations</small></div>
   <div><span>Held-out trades</span><b>{tests?tests.test.trades:"—"}</b><small>{tests?.test.netMeanPct===null?"Awaiting a measurable result":tests?"Net mean "+pct(tests.test.netMeanPct):"Historical validation"}</small></div>
  </div>
  {loading&&<div className={styles.message} role="status"><Database size={20}/><div><h3>Connecting the evidence.</h3><p>Loading recorded incidents, market depth and validation results.</p></div></div>}
  {error&&<div className={styles.message} role="alert"><Clock3 size={20}/><div><h3>Research feed unavailable.</h3><p>Refresh observations to retry. Previously recorded evidence is retained.</p></div></div>}
  {data&&<div className={styles.workspace}>
   <Tabs defaultValue="markets" className={styles.analysis}>
    <TabsList className={styles.tabs} aria-label="Decision research views">
     <TabsTrigger value="markets" className={styles.tab}>Market dislocations <span>{routes.length}</span></TabsTrigger>
     <TabsTrigger value="evidence" className={styles.tab}>Event evidence <span>{data.signals.length}</span></TabsTrigger>
     <TabsTrigger value="history" className={styles.tab}>Historical test</TabsTrigger>
    </TabsList>
    <TabsContent value="markets" className={styles.panel}>
     <div className={styles.panelHeading}><div><span className={styles.overline}>01 / Market comparison</span><h3>Price is only the starting point.</h3></div><span className={styles.status}>{snapshotFresh?"Recent snapshot":"Recorded snapshot"}</span></div>
     <p className={styles.intro}>Compare both routes at the same trade size. The net estimate includes displayed depth, assumed fees, slippage and rebalancing.</p>
     <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Cross-exchange route comparison">
      <table className={styles.table}><thead><tr><th>Market / route</th><th>Buy VWAP</th><th>Sell VWAP</th><th>Net estimate</th><th>Review</th></tr></thead>
       <tbody>{routes.map(route=><tr key={routeId(route)} data-selected={selected&&routeId(selected)===routeId(route)}>
        <td><strong>{route.symbol}</strong><small>{route.buy} <ArrowRight size={10}/> {route.sell}</small></td>
        <td>{money(route.buyVwap)}</td><td>{money(route.sellVwap)}</td><td className={route.netUsd!==null&&route.netUsd>0?styles.positive:styles.negative}>{money(route.netUsd)}<small>{route.quantity} units</small></td>
        <td><Button variant="ghost" size="icon-sm" aria-label={"Inspect "+route.symbol+" "+route.buy+" to "+route.sell} aria-pressed={!!selected&&routeId(selected)===routeId(route)} onClick={()=>setRouteKey(routeId(route))}><ChevronRight size={16}/></Button></td>
       </tr>)}</tbody>
      </table>
      {!routes.length&&<div className={styles.empty}><h4>Waiting for paired market observations.</h4><p>Both venues must return matching markets before a route can be evaluated.</p></div>}
     </div>
     {selected&&<div className={styles.routeDetail}>
      <div className={styles.detailHead}><span className={styles.overline}>Selected route</span><span className={styles.blocked}>{selected.decision==="BLOCKED"?"Execution blocked":"Paper candidate only"}</span></div>
      <h4>{selected.symbol} <span>{selected.buy} <ArrowRight size={17}/> {selected.sell}</span></h4>
      <div className={styles.gates}>{gates.map(g=><div key={g.label}><span className={g.pass?styles.pass:styles.pending}>{g.pass?<Check size={13}/>:<span>—</span>}</span><div><b>{g.label}</b><small>{g.detail}</small></div></div>)}</div>
      <details className={styles.details}><summary>Full execution assessment <span>{selected.blockers.length} conditions</span></summary><ul>{selected.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul><p>Public order books show visible liquidity at observation time. They do not confirm account permissions or a fill.</p></details>
     </div>}
     <div className={styles.sourceBar}><span>Sources: Kraken Spot · Coinbase Exchange</span><span>USD pairs · REST depth · five-minute sampling</span></div>
    </TabsContent>
    <TabsContent value="evidence" className={styles.panel}>
     <div className={styles.panelHeading}><div><span className={styles.overline}>02 / Event attribution</span><h3>Follow the dependency.</h3></div><a className={styles.textLink} href="/radar">Open radar <ArrowRight size={13}/></a></div>
     {data.signals.length?<div className={styles.signals}>{data.signals.map((s,i)=><article key={s.signalId}><span className={styles.ordinal}>{String(i+1).padStart(2,"0")}</span><div><span className={styles.overline}>{s.provider}</span><h4>{s.symbol} <small>{s.direction} hypothesis</small></h4><p>{s.reason}</p><time>{stamp(s.observedAt)}</time></div><span className={styles.status}>Research</span></article>)}</div>:<div className={styles.empty}><RadioTower size={26}/><span className={styles.overline}>Rule outage-v1 retired</span><h4>Outages are monitored, not traded.</h4><p>{data.outageRule?.reason ?? "A historical study found no tradable effect of outages on the provider's stock."}</p><a className={styles.textLink} href="/_api/research/outage_impact">Read the outage study <ArrowRight size={13}/></a></div>}
     <ol className={styles.process}><li><span>01</span><b>Detect</b><p>Record a qualifying provider incident.</p></li><li><span>02</span><b>Map</b><p>Link the provider to its listed parent.</p></li><li><span>03</span><b>Validate</b><p>Test the direction against later prices.</p></li></ol>
     <p className={styles.footnote}>One observation origin. A provider relationship establishes exposure; it does not establish material financial impact.</p>
    </TabsContent>
    <TabsContent value="history" className={styles.panel}>
     <div className={styles.panelHeading}><div><span className={styles.overline}>03 / Historical validation</span><h3>Evidence before allocation.</h3></div><span className={styles.status}>{data.outageRule?.study?.supported===false?"Not supported · retired":tests?.status==="insufficient_history"?"Insufficient history":"Research sample"}</span></div>
     {data.outageRule?.study&&<div className={styles.split}><div><span>Outage-day reaction / {data.outageRule.study.events} outages</span><strong>{pct(data.outageRule.study.reactionMeanPct)}<small> t {data.outageRule.study.reactionT?.toFixed(2)??"—"}</small></strong></div><div><span>Short after the outage day, net of costs</span><strong>{pct(data.outageRule.study.shortNetMeanPct)}<small> per trade</small></strong></div></div>}
     {data.outageRule?.study&&<p className={styles.intro}>{data.outageRule.study.conclusion} Pre-registered study of major public outages, 2011-2025, SPY market model.</p>}
     <p className={styles.intro}>The forward test below stays in place for the record; it no longer receives new outage signals.</p>
     <div className={styles.split}><div><span>Earlier sample / 70%</span><strong>{tests?.train.trades??"—"}<small> completed trades</small></strong></div><div><span>Held-out sample / 30%</span><strong>{tests?.test.trades??"—"}<small> completed trades</small></strong></div></div>
     <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Measure</th><th>Earlier sample</th><th>Held-out sample</th></tr></thead><tbody>
      <tr><td>Mean return after costs</td><td>{pct(tests?.train.netMeanPct)}</td><td>{pct(tests?.test.netMeanPct)}</td></tr>
      <tr><td>Winning trades</td><td>{tests?.train.winRate==null?"—":(tests.train.winRate*100).toFixed(1)+"%"}</td><td>{tests?.test.winRate==null?"—":(tests.test.winRate*100).toFixed(1)+"%"}</td></tr>
     </tbody></table></div>
     {!tests?.test.trades&&<div className={styles.validationNote}><Clock3 size={18}/><div><strong>No forward trades, by design.</strong><p>The historical study answered the question first, so no outage trades are being collected. A blank result remains blank.</p></div></div>}
     <div className={styles.assumptions}><div><span>Holding period</span><b>{tests?.horizonBars} sessions</b></div><div><span>Costs per side</span><b>{tests?.costBpsPerSide} bps</b></div><div><span>Annual borrow assumption</span><b>{tests?.borrowAnnualBps} bps</b></div><div><span>Boundary exclusions</span><b>{tests?.embargoed} trades</b></div></div>
     <details className={styles.details}><summary>Method & limitations</summary><p>Entry is the next daily open after the first system observation. Exit uses completed sessions. Overlapping positions in the same instrument and training trades crossing the test boundary are excluded.</p><ul>{tests?.limitations.map(item=><li key={item}>{item}</li>)}</ul></details>
    </TabsContent>
   </Tabs>
   <aside className={styles.rail} aria-label="Research decision and broker status">
    <div className={styles.railBlock}><span className={styles.overline}>Current mandate</span><h3>Observe.<br/>Verify.<br/><em>Then act.</em></h3><p>Collect evidence until the opportunity survives both the historical test and execution constraints.</p><div className={styles.mandate}><span className={styles.status}>Research only</span><small>No live allocation</small></div></div>
    <div className={styles.railBlock}><div className={styles.railTitle}><ShieldCheck size={16}/><span className={styles.overline}>Broker connection</span></div><div className={styles.brokerTitle}><strong>Alpaca</strong><span className={connected?styles.connected:styles.status}>{connected?"Connected":"Unverified"}</span></div><p>Paper account · simulated capital</p><dl className={styles.brokerFacts}><div><dt>Order routing</dt><dd>{health?.killed===false?"Paper enabled":"Standby"}</dd></div><div><dt>Per-order limit</dt><dd>$50</dd></div><div><dt>Daily paper budget</dt><dd>$150</dd></div><div><dt>Real-money trading</dt><dd>Disabled</dd></div></dl><small className={styles.checked}>Checked {stamp(health?.at)}</small>{!connected&&<p className={styles.footnote}>{health?.error??"A recent successful account check is required."}</p>}</div>
    <div className={styles.railBlock}><span className={styles.overline}>Reading this view</span><p>Positive price differences can disappear after fees, slippage or transfer restrictions. A blocked route keeps its reason attached.</p><a className={styles.textLink} href="/data">Explore dependency evidence <ArrowRight size={13}/></a></div>
   </aside>
  </div>}
 </section>;
}

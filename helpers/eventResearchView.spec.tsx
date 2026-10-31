import {render,fireEvent,cleanup} from "@testing-library/react";
import {EventResearch} from "../components/EventResearch";
import type {OutputType} from "../endpoints/event_execution_GET.schema";
const snapshot={
 signals:[],bookSnapshotCount:12,
 broker:{health:{connected:true,killed:true,at:new Date().toISOString()}},
 lastRun:{at:new Date().toISOString(),books:[],routes:[
 {symbol:"BTC/USD",buy:"Kraken",sell:"Coinbase",quantity:.001,buyVwap:80000,sellVwap:80001,netUsd:-2,decision:"BLOCKED",blockers:["Fees unverified"]},
 {symbol:"BTC/USD",buy:"Coinbase",sell:"Kraken",quantity:.001,buyVwap:80001,sellVwap:80000,netUsd:-3,decision:"BLOCKED",blockers:["Insufficient sell-side asset inventory"]}
 ]},
 backtest:{status:"insufficient_history",train:{trades:0,netMeanPct:null,winRate:null},test:{trades:0,netMeanPct:null,winRate:null},horizonBars:5,costBpsPerSide:15,borrowAnnualBps:500,embargoed:0,limitations:["Daily prices are proxies"]}
} as unknown as OutputType;
describe("Event research interaction",()=>{
 let originalEvent:typeof Event,originalCustomEvent:typeof CustomEvent;
 beforeEach(()=>{originalEvent=globalThis.Event;originalCustomEvent=globalThis.CustomEvent;globalThis.Event=window.Event;globalThis.CustomEvent=window.CustomEvent;});
 afterEach(()=>{cleanup();globalThis.Event=originalEvent;globalThis.CustomEvent=originalCustomEvent;});
 it("lets the reader inspect either market route and its constraints",()=>{
  const view=render(<EventResearch data={snapshot} loading={false} error={false} refreshing={false} onRefresh={()=>{}}/>);
  const route=view.getByRole("button",{name:"Inspect BTC/USD Coinbase to Kraken"});
  fireEvent.click(route);
  expect(route.getAttribute("aria-pressed")).toBe("true");
  expect(view.getByText("Insufficient sell-side asset inventory")).toBeTruthy();
  expect(view.getByText("Connected")).toBeTruthy();
 });
 it("switches to the historical view and keeps unavailable returns blank",()=>{
  const view=render(<EventResearch data={snapshot} loading={false} error={false} refreshing={false} onRefresh={()=>{}}/>);
  fireEvent.mouseDown(view.getByRole("tab",{name:"Historical test"}),{button:0,ctrlKey:false});
  expect(view.getByRole("tabpanel").textContent).toContain("No forward trades, by design.");
  expect(view.getByRole("tabpanel").textContent).not.toContain("NaN");
 });
});

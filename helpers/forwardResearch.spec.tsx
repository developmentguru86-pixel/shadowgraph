import {forwardResearch,type ResearchTrade} from "./forwardResearch";
import type {AlphaSetup} from "../endpoints/alpha_GET.schema";
const setup:AlphaSetup={signalId:"test-1",generatedAt:"2026-10-09T10:00:00Z",instrument:"BTC",direction:"LONG",state:"ARMED",confidence:85,evidenceCount:4,currentPrice:99,trigger:100,stop:95,target1:108,target2:112,rewardRisk:2.4,atr15m:2,hiddenChain:[],thesis:"test",invalidation:"95"};
const create=()=>forwardResearch.step([],setup,{BTC:99},{BTC:"2026-10-09T10:00:00Z"},"2026-10-09T10:00:00Z");
const active=()=>forwardResearch.step(create(),null,{BTC:101},{BTC:"2026-10-09T10:15:00Z"},"2026-10-09T10:15:00Z");
describe("forwardResearch",()=>{
 it("never fills a quote that preceded publication",()=>{const t=forwardResearch.step([],setup,{BTC:101},{BTC:"2026-10-09T09:59:00Z"},"2026-10-09T10:00:00Z")[0];expect(t.state).toBe("ARMED");expect(t.entry).toBeNull();});
 it("uses the observed gap price rather than inventing a trigger fill",()=>{expect(active()[0].entry).toBe(101);});
 it("invalidates a gap beyond the target",()=>{const t=forwardResearch.step(create(),null,{BTC:113},{BTC:"2026-10-09T10:15:00Z"},"2026-10-09T10:15:00Z")[0];expect(t.state).toBe("INVALIDATED");expect(t.netR).toBeUndefined();});
 it("uses the adverse observed stop-gap and subtracts assumed costs",()=>{const t=forwardResearch.step(active(),null,{BTC:93},{BTC:"2026-10-09T10:30:00Z"},"2026-10-09T10:30:00Z")[0];expect(t.state).toBe("STOPPED");expect(t.grossR).toBeCloseTo(-8/6,8);expect(t.netR!).toBeLessThan(t.grossR!);});
 it("does not mutate a resolved episode",()=>{const t=forwardResearch.step(active(),null,{BTC:93},{BTC:"2026-10-09T10:30:00Z"},"2026-10-09T10:30:00Z");expect(forwardResearch.step(t,null,{BTC:115},{BTC:"2026-10-09T10:45:00Z"},"2026-10-09T10:45:00Z")).toEqual(t);});
 it("does not resolve from stale or repeated quotes",()=>{const a=active();expect(forwardResearch.step(a,null,{BTC:90},{BTC:"2026-10-09T10:15:00Z"},"2026-10-09T10:45:00Z")).toEqual(a);expect(forwardResearch.step(a,null,{BTC:90},{BTC:"2026-10-09T10:20:00Z"},"2026-10-09T12:00:00Z")).toEqual(a);});
 it("does not overwrite a published stop with a newer setup",()=>{const t=forwardResearch.step(active(),{...setup,stop:97}, {BTC:102},{BTC:"2026-10-09T10:30:00Z"},"2026-10-09T10:30:00Z");expect(t.length).toBe(1);expect(t[0].stop).toBe(95);});
 it("expires armed setups with no fictitious P&L",()=>{const t=forwardResearch.step(create(),null,{},{},"2026-10-09T17:00:00Z")[0];expect(t.state).toBe("INVALIDATED");expect(t.netR).toBeUndefined();});
 it("handles short positions and adverse stop gaps",()=>{const s={...setup,direction:"SHORT" as const,trigger:100,stop:105,target1:92,target2:88};const first=forwardResearch.step([],s,{},{},"2026-10-09T10:00:00Z");const a=forwardResearch.step(first,null,{BTC:99},{BTC:"2026-10-09T10:15:00Z"},"2026-10-09T10:15:00Z");const t=forwardResearch.step(a,null,{BTC:107},{BTC:"2026-10-09T10:30:00Z"},"2026-10-09T10:30:00Z")[0];expect(t.state).toBe("STOPPED");expect(t.grossR).toBeCloseTo(-8/6,8);});
 it("shows no win probability when there are no resolved observations",()=>{const s=forwardResearch.summary(create());expect(s.winRate).toBeNull();expect(s.winRateInterval).toBeNull();expect(s.validationStatus).toBe("not_validated");});
});

import { dependencyAtlas, type AtlasEvent } from "./dependencyAtlas";
describe("Dependency atlas evidence boundaries",()=>{
 const now=Date.parse("2026-10-08T12:00:00Z");
 const event:AtlasEvent={id:"a",title:"Data center investment cancelled",url:"https://example.org/a",source:"Fixture",publishedAt:"2026-10-07",kind:"news"};
 it("keeps cancellation headlines as candidates, never confirmed or positive signals",()=>{
  const row=dependencyAtlas.analyze([event],now).find(c=>c.id==="ai-power")!;
  expect(row.matches.length).toBe(1);expect(row.status).toBe("hypothesis");expect(row.pricingStatus).toBe("not_assessed");
 });
 it("rejects stale, future and undated events",()=>{
  const events=["2026-01-01","2027-01-01","bad"].map((publishedAt,i)=>({...event,id:String(i),publishedAt,url:"https://example.org/"+i}));
  expect(dependencyAtlas.analyze(events,now).every(c=>!c.matches.length)).toBeTrue();
 });
 it("deduplicates tracking URLs",()=>{
  const rows=dependencyAtlas.analyze([event,{...event,id:"b",url:event.url+"?utm_source=x"}],now);
  expect(rows.find(c=>c.id==="ai-power")!.matches.length).toBe(1);
 });
 it("does not fabricate evidence when sources are empty",()=>{
  expect(dependencyAtlas.analyze([],now).every(c=>c.matches.length===0&&c.status==="hypothesis")).toBeTrue();
 });
 it("does not match an unrelated generic AI substring",()=>{
  expect(dependencyAtlas.analyze([{...event,title:"Retail company files annual report"}],now).every(c=>!c.matches.length)).toBeTrue();
 });
 it("includes a primary source, measurable checks and competing explanations in every channel",()=>{
  for(const c of dependencyAtlas.channels){expect(c.source.url.startsWith("https://")).toBeTrue();expect(c.stages.length).toBe(3);expect(c.invalidation.length).toBeGreaterThan(20);expect(c.alternative.length).toBeGreaterThan(20);}
 });
});
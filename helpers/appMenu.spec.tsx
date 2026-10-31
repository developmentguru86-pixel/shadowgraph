import {render,fireEvent,cleanup} from "@testing-library/react";
import {AppMenu} from "../components/AppMenu";
describe("global navigation categories",()=>{
 let originalEvent:typeof Event,originalCustomEvent:typeof CustomEvent;
 beforeEach(()=>{originalEvent=globalThis.Event;originalCustomEvent=globalThis.CustomEvent;globalThis.Event=window.Event;globalThis.CustomEvent=window.CustomEvent;});
 afterEach(()=>{cleanup();globalThis.Event=originalEvent;globalThis.CustomEvent=originalCustomEvent;});
 it("opens from keyboard and exposes real category links",()=>{
  const view=render(<AppMenu/>);
  const trigger=view.getByRole("button",{name:"Open navigation menu"});
  try { fireEvent.keyDown(trigger,{key:"ArrowDown"}); } catch(e) { throw Error(e instanceof AggregateError?e.errors.map(x=>String(x?.stack??x)).join("\n"):String(e)); }
  const menu=view.getByRole("menu",{name:"Open navigation menu"});
  for (const step of ["Dependencies","Monitoring","Evidence","Impact","Build on it"]) expect(menu.textContent).toContain(step);
  const links=[...menu.querySelectorAll("a")];
  expect(links.some(a=>a.getAttribute("href")==="/terminal")).toBeTrue();
  expect(links.some(a=>a.getAttribute("href")==="/radar")).toBeTrue();
  expect(links.some(a=>a.getAttribute("href")==="/boards")).toBeTrue();
  expect(links.some(a=>a.getAttribute("href")==="/terminal#event-signals")).toBeTrue();
 });
 it("places every page in exactly one step",async()=>{
  const {stageOf}=await import("./productMap");
  expect(stageOf("/boards/stripe")?.key).toBe("monitoring");
  expect(stageOf("/status/github-api")?.key).toBe("monitoring");
  expect(stageOf("/company/apple")?.key).toBe("dependencies");
  expect(stageOf("/research/radar-accuracy")?.key).toBe("evidence");
  expect(stageOf("/research/concentration-signal")?.key).toBe("impact");
  expect(stageOf("/terminal")?.key).toBe("impact");
  expect(stageOf("/pricing")).toBeNull();
  expect(stageOf("/")).toBeNull();
 });
});

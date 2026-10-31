import {paperBroker} from "./paperBroker";
import {mppStore} from "./mppStore";
describe("paper broker account safety",()=>{
 let oldKey:string|undefined,oldSecret:string|undefined;
 beforeEach(()=>{oldKey=process.env.ALPACA_PAPER_KEY_ID;oldSecret=process.env.ALPACA_PAPER_SECRET_KEY;process.env.ALPACA_PAPER_KEY_ID="test-key";process.env.ALPACA_PAPER_SECRET_KEY="test-secret";spyOn(mppStore,"put").and.resolveTo();spyOn(mppStore,"get").and.resolveTo(null);});
 afterEach(()=>{if(oldKey===undefined)Reflect.deleteProperty(process.env,"ALPACA_PAPER_KEY_ID");else process.env.ALPACA_PAPER_KEY_ID=oldKey;if(oldSecret===undefined)Reflect.deleteProperty(process.env,"ALPACA_PAPER_SECRET_KEY");else process.env.ALPACA_PAPER_SECRET_KEY=oldSecret;});
 it("uses only the fixed paper endpoint and keeps kill enabled by default",async()=>{const f=spyOn(globalThis,"fetch").and.resolveTo(Response.json({status:"ACTIVE",trading_blocked:false,account_blocked:false}));const h=await paperBroker.status();expect(h.connected).toBeTrue();expect(h.killed).toBeTrue();expect(h.liveEnabled).toBeFalse();expect(String(f.calls.mostRecent().args[0])).toBe("https://paper-api.alpaca.markets/v2/account");});
 it("does not mistake saved credentials for successful authentication",async()=>{spyOn(globalThis,"fetch").and.resolveTo(new Response("",{status:401}));const h=await paperBroker.status();expect(h.connected).toBeFalse();expect(h.error).toContain("401");});
 it("blocks restricted accounts",async()=>{spyOn(globalThis,"fetch").and.resolveTo(Response.json({status:"ACTIVE",trading_blocked:true}));expect((await paperBroker.status()).connected).toBeFalse();});
 it("rejects oversized orders before database or network access",async()=>{const f=spyOn(globalThis,"fetch");await expectAsync(paperBroker.submit({id:"safety-test",symbol:"BTC/USD",side:"buy",qty:1,limitPrice:100})).toBeRejectedWithError("Paper order must be between $1 and $50");expect(f).not.toHaveBeenCalled();});
 it("rejects NaN quantities",async()=>{await expectAsync(paperBroker.submit({id:"safety-test",symbol:"BTC/USD",side:"buy",qty:NaN,limitPrice:100})).toBeRejected();});
 it("never permits a live mode through kill-switch changes",async()=>{const r=await paperBroker.setKill(false);expect(r.liveEnabled).toBeFalse();expect(mppStore.put).toHaveBeenCalledWith("economic:broker:kill",false);});
});

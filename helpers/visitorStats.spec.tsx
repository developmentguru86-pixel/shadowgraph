import { isBotUA, deviceOf, cleanPath, referrerHost } from "./visitorStats";

describe("visitor counting", () => {
  it("separates crawlers and scripts from browsers", () => {
    expect(isBotUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBeFalse();
    expect(isBotUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBeFalse();
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "node", "python-httpx/0.27", "curl/8.4.0", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)", "shadowgraph-regression-test", ""])
      expect(isBotUA(ua)).withContext(ua).toBeTrue();
  });
  it("classifies devices", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15")).toBe("desktop");
  });
  it("cleans paths and keeps external referrers only", () => {
    expect(cleanPath("/status/aws?x=1#top")).toBe("/status/aws");
    expect(cleanPath("")).toBe("/");
    expect(referrerHost("https://www.google.com/search?q=x", "shadowalpha.online")).toBe("google.com");
    expect(referrerHost("https://shadowalpha.online/radar", "shadowalpha.online")).toBeNull();
    expect(referrerHost("https://www.shadowalpha.online/", "shadowalpha.online")).toBeNull();
    expect(referrerHost("not a url", null)).toBeNull();
  });
});

import { render, fireEvent, cleanup } from "@testing-library/react";
import { StackLab } from "../components/StackLab";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";

const svc = (id: string, name: string, hosting: string | null, region: string | null, cdn: string | null, dns: string | null): RadarServiceRow => ({
  id, name, category: "Test", hostingProvider: hosting, hostingRegion: region, hostingCountry: null, cdn, dnsProvider: dns, emailProvider: null,
  analyzedHost: null, state: "up", httpStatus: 200, latencyMs: 100, error: null, uptime24h: 1, samples24h: 288,
} as RadarServiceRow);

const SERVICES = [
  svc("stripe", "Stripe API", "Amazon Web Services", "us-east-1", null, "AWS Route 53"),
  svc("slack", "Slack API", "Amazon Web Services", "us-east-1", null, "AWS Route 53"),
  svc("github", "GitHub API", "GitHub (own network)", null, null, "AWS Route 53"),
  svc("shopify", "Shopify", "Google Cloud", null, "Cloudflare", "Cloudflare"),
  svc("google", "Google accounts", "Google Cloud", null, null, "Google Cloud DNS"),
  svc("other", "Other API", "Fastly", null, "Fastly", "NS1"),
];

describe("homepage stack lab", () => {
  let originalEvent: typeof Event, originalCustomEvent: typeof CustomEvent;
  beforeEach(() => { originalEvent = globalThis.Event; originalCustomEvent = globalThis.CustomEvent; globalThis.Event = window.Event; globalThis.CustomEvent = window.CustomEvent; });
  afterEach(() => { cleanup(); globalThis.Event = originalEvent; globalThis.CustomEvent = originalCustomEvent; });

  it("preselects five tools and draws a path from every tool to each of its providers", () => {
    const view = render(<StackLab services={SERVICES} />);
    expect(view.getAllByText(/Stripe API|Slack API|GitHub API|Shopify|Google accounts/).length).toBeGreaterThanOrEqual(5);
    const svg = view.container.querySelector("svg[aria-label='Dependency graph']")!;
    expect(svg).toBeTruthy();
    // tool -> provider edges: stripe 3, slack 3, github 2, shopify 3, google 2 = 13
    expect(svg.querySelectorAll("path").length).toBe(13);
    expect(view.container.textContent).toContain("Shared paths");
    expect(view.container.textContent).toContain("3/5"); // AWS Route 53 shared by 3 of 5
    const full = view.container.querySelector("a[href^='/check?s=']")!;
    expect(full.getAttribute("href")).toContain("stripe");
  });

  it("switches to the what-if tab", () => {
    const view = render(<StackLab services={SERVICES} />);
    fireEvent.click(view.getByRole("tab", { name: "What if… goes down?" }));
    expect(view.container.textContent).toContain("Pick a provider");
  });
});

# ShadowGraph

Live outage radar and internet dependency intelligence for about 3,200 services: APIs, SaaS, banks, the most-visited websites and cloud regions. ShadowGraph probes every endpoint every 5 minutes, re-checks failures from six continents, maps what each service runs on (hosting, cloud region, CDN, DNS, email) and publishes the results as a website, a JSON API, an MCP server and an A2A agent.

- Website: https://shadowalpha.online
- API reference: https://shadowalpha.online/docs
- OpenAPI 3.1: [`static/openapi.json`](static/openapi.json)
- MCP server: `https://shadowalpha.online/_api/mcp`
- A2A agent card: [`static/.well-known/agent-card.json`](static/.well-known/agent-card.json)

> This repository is a source snapshot of the ShadowGraph platform (state: 14 October 2026). Secrets are not part of the code (see [Configuration](#configuration)).

## What it does

| Area | Pages | What it is |
|---|---|---|
| Outage radar | `/radar`, `/is-it-down`, `/status/:slug`, `/de/ist-es-down`, `/de/status/:slug` | Live state of every monitored service, provider incidents with blast radius, plain-language "is it down?" pages in English and German, free email alerts |
| Risk outlook | `/outlook`, `/signals` | Gray-failure early warnings, certificate and domain expiry, shared-provider signals from official status pages |
| Stack check and vendor risk | `/check`, `/vendors`, `/alerts` | Map your own stack or up to 300 ICT vendors (DORA register), paid Stack Alerts ($29/month) |
| Research and open data | `/research/*`, `/report`, `/research/data` | Shared-fate study, radar accuracy, concentration, outage event study, CC BY 4.0 datasets |
| Dependency data | `/data` | Customer to supplier revenue dependencies from SEC filings ($99/month dataset) |
| Machine intelligence | `/terminal`, `/_api/mcp`, `/_api/a2a`, `/_api/machine/intelligence` | Free factual tools plus pay-per-call intelligence over the Machine Payments Protocol (HTTP 402 / MCP error -32042, Stripe) |
| Developers | `/docs` | API reference generated from `static/openapi.json`, MCP / A2A / OpenAPI sections |

## Repository layout

Every folder has a fixed role.

```
base.css                    design tokens (colours, type, spacing)
pages/                      30 routes; dots are path segments (de.status.$provider.tsx -> /de/status/:provider)
  *.pageLayout.tsx          layout wrappers per page
  *.prefetch.ts             server-side data for SSR
components/                 65 React components (+ design-system kit and *.example.tsx showcases)
endpoints/                  85 serverless handlers: name_GET.ts / name_POST.ts served at /_api/name, typed client in *.schema.ts
helpers/                    82 modules: jobs, detection, research, payments, data access (+ 20 *.spec.tsx Jasmine tests)
static/                     public files (openapi.json, llms.txt, server.json, .well-known/*, robots.txt)
```

Key modules:

| Module | Role |
|---|---|
| `helpers/radarJob.tsx`, `helpers/radarDetect.tsx` | 5-minute probe sweep, state machine (up / degraded / down), provider incident detection |
| `helpers/globalProbeJob.tsx` | Worldwide re-checks from six continents (Globalping) |
| `helpers/statusPage.tsx`, `helpers/statusCopy.tsx` | Data and EN/DE copy behind the "is it down?" pages |
| `helpers/freeAlerts.tsx`, `helpers/stackAlerts.tsx` | Free email alerts and paid Stack Alerts |
| `helpers/upstreamJob.tsx`, `helpers/upstreamDetect.tsx` | Shared-provider signals from official status pages (rule cs-v1) |
| `helpers/researchJob.tsx`, `helpers/researchStats.tsx` | Hourly research recomputation |
| `helpers/paidMachineIntelligence.tsx` | MPP payment challenge / verification (HTTP and MCP bindings) |
| `helpers/mcpCatalog.tsx` | MCP server identity and tool catalog, shared by `/_api/mcp` and `/docs` |
| `helpers/schema.tsx`, `helpers/db.tsx` | Typed Postgres schema (Kysely) and connection |

## Scheduled jobs

UTC unless noted:

| Job | Schedule |
|---|---|
| radarJob | every 5 minutes |
| upstreamJob | every 10 minutes (:03, :13, …) |
| economicResearchJob | every 15 minutes (:02, :17, :32, :47) |
| globalProbeJob | every 30 minutes (:07, :37) |
| researchJob | hourly at :09 |
| agentProbeJob | hourly at :50 |
| radarExpiryJob | daily 03:20 |
| secConcJob | daily 04:00 Europe/Vienna |
| geoRefreshJob | Sundays 04:40 |
| agentDirectoryJob | Sundays 05:25 |

## Configuration

No credentials are stored in this repository. The app reads them at runtime:

| Name | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | env | Postgres connection |
| `STRIPE_LIVE_SECRET_KEY_V2` / `STRIPE_MPP_SECRET_KEY` / `STRIPE_SECRET_KEY` | env | Stripe secret keys for subscriptions and machine payments |
| `ALPACA_PAPER_KEY_ID`, `ALPACA_PAPER_SECRET_KEY` | env | Paper-trading research only |
| `app_config.mpp_secret` | database | HMAC secret for payment challenges and signed internal operations |
| `app_config.stats_key` | database | Key for the private `/stats` page |
| `mpp_store "config:alerts:emailFrom"` | database | Verified sender for alert emails (not yet set) |

See [`.env.example`](.env.example).

## Development

Stack: React 19, React Router, TanStack Query, Kysely on Postgres, serverless endpoints, SSR. Runtime modules imported as `@runtime/*` (`queueTask`, `realtime`, `email`, `prefetch`, `storage`) are provided by the hosting platform, so this snapshot does not build stand-alone without them. `package.json` lists the resolved dependencies for reference.

Tests are Jasmine specs in `helpers/*.spec.tsx`.

## License

Proprietary. All rights reserved. The published research datasets are licensed separately under CC BY 4.0 (see `/research/data`).

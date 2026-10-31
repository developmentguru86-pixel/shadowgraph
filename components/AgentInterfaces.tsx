import { useEffect, useState } from "react";
import { CodeBlock, TabbedCode, CopyButton } from "./DocsCode";
import { MCP_ENDPOINT, MCP_REGISTRY_NAME, MCP_MODERN, MCP_LEGACY, MCP_SERVER_INFO, MCP_TOOLS, mcpToolPrice, mcpToolSummary } from "../helpers/mcpCatalog";
import styles from "./AgentInterfaces.module.css";

/**
 * The machine interfaces on /docs, laid out like the reference docs of popular APIs: what it is, the endpoint, a
 * "connect" panel per client, the catalog (MCP tools / A2A skills) and the raw manifest. The MCP catalog is imported
 * from the same module the MCP endpoint serves, so it cannot drift; the agent card and server.json are the live files.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const A2A_URL = "https://shadowalpha.online/_api/a2a";
const CARD_PATH = "/.well-known/agent-card.json";
const usd = (n: number) => `$${n.toFixed(2)}`;
const skillPrice = (d: string) => { const m = /Paid \$(\d+(?:\.\d+)?)/.exec(d); return m ? Number(m[1]) : null; };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span>{label}</span>{children}</div>;
}
function Endpoint({ url }: { url: string }) {
  return <span className={styles.endpoint}><code>{url}</code><CopyButton text={url} /></span>;
}
function Raw({ title, data, file }: { title: string; data: J; file: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.raw} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><span>{title}</span><a href={file} onClick={(e) => e.stopPropagation()}>{file}</a></summary>
      {open && (data ? <CodeBlock code={JSON.stringify(data, null, 2)} json title={file} maxHeight={520} /> : <p className={styles.muted}>Loading…</p>)}
    </details>
  );
}

export function AgentInterfaces({ spec, base }: { spec: J; base: string }) {
  const [card, setCard] = useState<J>(null);
  const [manifest, setManifest] = useState<J>(null);
  useEffect(() => {
    fetch(CARD_PATH).then((r) => (r.ok ? r.json() : null)).then(setCard).catch(() => undefined);
    fetch("/server.json").then((r) => (r.ok ? r.json() : null)).then(setManifest).catch(() => undefined);
  }, []);
  return (
    <>
      <McpSection manifest={manifest} />
      <A2aSection card={card} />
      <OpenApiSection spec={spec} base={base} />
    </>
  );
}

// ---------------------------------------------------------------- MCP
function McpSection({ manifest }: { manifest: J }) {
  const free = MCP_TOOLS.filter((t) => mcpToolPrice(t) === null).length;
  const paid = MCP_TOOLS.length - free;
  const url = MCP_ENDPOINT;
  const rpc = (method: string, params?: J, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  const curlRpc = (body: string) => `curl -s ${url} \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '${body}'`;

  return (
    <section className={styles.section} id="mcp-server" data-spy>
      <span className={styles.eyebrow}>Model Context Protocol</span>
      <h2 className={styles.h2}>MCP server</h2>
      <p className={styles.p}>Connect Claude, Cursor, VS Code or your own agent to ShadowGraph in one line. {free} free tools answer factual questions; {paid} paid tools return deeper intelligence, settled per call over the Machine Payments Protocol. No API key, no account.</p>

      <div className={styles.facts}>
        <Fact label="Endpoint"><Endpoint url={url} /></Fact>
        <Fact label="Transport"><b>Streamable HTTP · JSON responses</b></Fact>
        <Fact label="Protocol"><b>{MCP_LEGACY} · {MCP_MODERN}</b></Fact>
        <Fact label="MCP Registry"><b className={styles.mono}>{MCP_REGISTRY_NAME}</b><small>v{manifest?.version ?? MCP_SERVER_INFO.version}</small></Fact>
      </div>

      <h3 className={styles.h3}>Connect</h3>
      <TabbedCode tabs={[
        { label: "Claude Code", code: `claude mcp add --transport http shadowgraph ${url}`, note: <>Run in a terminal, then type <code>/mcp</code> in Claude Code to see the tools.</> },
        { label: "Claude app", code: `Settings → Connectors → Add custom connector\n\nName  ShadowGraph\nURL   ${url}`, note: <>Claude on the web and desktop. Then enable the connector in a chat from the tools menu.</> },
        { label: "Claude Desktop (JSON)", file: "claude_desktop_config.json", code: JSON.stringify({ mcpServers: { shadowgraph: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2), json: true, note: <>Bridges the remote server through <code>mcp-remote</code> (needs Node.js). Restart Claude Desktop afterwards.</> },
        { label: "Cursor", file: "~/.cursor/mcp.json", code: JSON.stringify({ mcpServers: { shadowgraph: { url } } }, null, 2), json: true },
        { label: "VS Code", file: ".vscode/mcp.json", code: JSON.stringify({ servers: { shadowgraph: { type: "http", url } } }, null, 2), json: true },
        { label: "Python SDK", file: "pip install mcp", code: `import asyncio\nfrom mcp import ClientSession\nfrom mcp.client.streamable_http import streamablehttp_client\n\nasync def main():\n    async with streamablehttp_client("${url}") as (read, write, _):\n        async with ClientSession(read, write) as session:\n            await session.initialize()\n            tools = await session.list_tools()\n            print([t.name for t in tools.tools])\n            result = await session.call_tool("shadowgraph_market_recap", {"limit": 5})\n            print(result.content)\n\nasyncio.run(main())` },
        { label: "TypeScript SDK", file: "npm i @modelcontextprotocol/sdk", code: `import { Client } from "@modelcontextprotocol/sdk/client/index.js";\nimport { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";\n\nconst client = new Client({ name: "my-agent", version: "1.0.0" });\nawait client.connect(new StreamableHTTPClientTransport(new URL("${url}")));\n\nconst { tools } = await client.listTools();\nconst recap = await client.callTool({ name: "shadowgraph_market_recap", arguments: { limit: 5 } });\nconsole.log(recap.content);` },
        { label: "cURL", code: `# list the tools\n${curlRpc(rpc("tools/list"))}\n\n# call a free tool\n${curlRpc(rpc("tools/call", { name: "shadowgraph_company_filings", arguments: { symbol: "NVDA", limit: 3 } }, 2))}` },
      ]} />

      <h3 className={styles.h3}>Tools <span className={styles.count}>{MCP_TOOLS.length}</span></h3>
      <div className={styles.tools}>
        {MCP_TOOLS.map((t) => {
          const price = mcpToolPrice(t);
          const params = Object.entries(t.inputSchema.properties);
          const req = new Set(t.inputSchema.required ?? []);
          return (
            <article key={t.name} className={styles.tool} id={`tool-${t.name}`}>
              <header>
                <code className={styles.toolName}>{t.name}</code>
                {price === null ? <span className={styles.free}>Free</span> : <span className={styles.paid}>{usd(price)} / call</span>}
              </header>
              <b className={styles.toolTitle}>{t.title}</b>
              <p>{mcpToolSummary(t)}</p>
              <div className={styles.params}>
                {params.length ? params.map(([k, v]) => (
                  <span key={k} title={v.description}><code>{k}</code>{v.type}{v.minimum !== undefined ? ` ${v.minimum}–${v.maximum}` : ""}{req.has(k) && <i>required</i>}</span>
                )) : <span className={styles.noParams}>No arguments</span>}
                {t.annotations.readOnlyHint && <span className={styles.hint}>read-only</span>}
              </div>
            </article>
          );
        })}
      </div>

      <h3 className={styles.h3} id="mcp-payments">Paid tools over MCP</h3>
      <ol className={styles.flow}>
        <li><span>1</span><div>Call the tool as usual. Without payment the server answers with JSON-RPC error <code>-32042</code>; <code>error.data.challenges</code> holds a Stripe charge challenge with the exact amount.</div></li>
        <li><span>2</span><div>Your agent's wallet creates a Stripe shared payment token for that challenge.</div></li>
        <li><span>3</span><div>Repeat the identical <code>tools/call</code> with the credential in <code>params._meta["org.paymentauth/credential"]</code>. The result carries the receipt in <code>result._meta["org.paymentauth/receipt"]</code>. Error <code>-32043</code> means the payment could not be verified; a fresh challenge is included.</div></li>
      </ol>
      <TabbedCode tabs={[
        { label: "1 · Call", json: true, code: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "shadowgraph_global_snapshot", arguments: {} } }, null, 2) },
        { label: "2 · Challenge", json: true, code: JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: -32042, message: "Payment Required", data: { httpStatus: 402, challenges: [{ id: "fmMdnhD4_ci3…", realm: "shadowalpha.online", method: "stripe", intent: "charge", request: { amount: "50", currency: "usd", methodDetails: { networkId: "profile_…", paymentMethodTypes: ["card", "link"] } }, description: "ShadowGraph hidden_chain intelligence", expires: "2026-10-14T19:14:25.132Z" }] } } }, null, 2) },
        { label: "3 · Paid retry", json: true, code: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "shadowgraph_global_snapshot", arguments: {}, _meta: { "org.paymentauth/credential": { challenge: { id: "fmMdnhD4_ci3…", "…": "the challenge exactly as received" }, payload: { spt: "spt_…" } } } } }, null, 2) },
        { label: "4 · Result", json: true, code: JSON.stringify({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "{ …intelligence… }" }], structuredContent: { "…": "…" }, _meta: { "org.paymentauth/receipt": "…" } } }, null, 2) },
      ]} />

      <Raw title="Registry manifest" data={manifest} file="/server.json" />
    </section>
  );
}

// ---------------------------------------------------------------- A2A
function A2aSection({ card }: { card: J }) {
  const iface = card?.supportedInterfaces?.[0];
  const url = iface?.url ?? A2A_URL;
  const skills: J[] = card?.skills ?? [];
  const body = { jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { role: "ROLE_USER", messageId: "m1", parts: [{ text: "What moved in global markets today?" }] } } };
  const caps = card?.capabilities ?? {};
  return (
    <section className={styles.section} id="a2a-agent" data-spy>
      <span className={styles.eyebrow}>Agent2Agent protocol</span>
      <h2 className={styles.h2}>A2A agent</h2>
      <p className={styles.p}>{card?.description ?? "ShadowGraph is also reachable as an A2A agent: other agents discover it through its agent card and talk to it over JSON-RPC."}</p>

      <div className={styles.facts}>
        <Fact label="Endpoint"><Endpoint url={url} /></Fact>
        <Fact label="Binding"><b>{iface ? `${iface.protocolBinding} · A2A ${iface.protocolVersion}` : "JSONRPC · A2A 1.0"}</b></Fact>
        <Fact label="Agent card"><a className={styles.mono} href={CARD_PATH}>{CARD_PATH}</a></Fact>
        <Fact label="Capabilities">
          <span className={styles.caps}>
            {["streaming", "pushNotifications", "extendedAgentCard"].map((k) => <span key={k} className={caps[k] ? styles.capOn : styles.capOff}>{caps[k] ? "✓" : "–"} {k}</span>)}
          </span>
        </Fact>
      </div>

      <h3 className={styles.h3}>Skills <span className={styles.count}>{skills.length || "…"}</span></h3>
      <div className={styles.tools}>
        {skills.map((s) => {
          const price = skillPrice(s.description ?? "");
          return (
            <article key={s.id} className={styles.tool}>
              <header><code className={styles.toolName}>{s.id}</code>{price === null ? <span className={styles.free}>Free</span> : <span className={styles.paid}>{usd(price)} / call</span>}</header>
              <b className={styles.toolTitle}>{s.name}</b>
              <p>{s.description}</p>
              {s.examples?.[0] && <q className={styles.example}>{s.examples[0]}</q>}
              <div className={styles.params}>{(s.tags ?? []).slice(0, 5).map((t: string) => <span key={t} className={styles.tag}>{t}</span>)}</div>
            </article>
          );
        })}
        {!skills.length && <p className={styles.muted}>Loading the agent card…</p>}
      </div>

      <h3 className={styles.h3}>Send a message</h3>
      <TabbedCode tabs={[
        { label: "cURL", code: `curl -s -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'` },
        { label: "JavaScript", code: `const res = await fetch("${url}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, "\n  ")}),\n});\nconst { result } = await res.json();\nconsole.log(result.message.parts[0].text);` },
        { label: "Python", code: `import requests\n\nbody = ${JSON.stringify(body, null, 4)}\nr = requests.post("${url}", json=body, timeout=30)\nprint(r.json()["result"]["message"]["parts"][0]["text"])` },
        { label: "Response", json: true, code: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { messageId: "6146b852-…", role: "ROLE_AGENT", parts: [{ text: "{\"type\":\"market_recap\",\"generatedAt\":\"…\",\"movers\":[…]}" }] } } }, null, 2) },
      ]} />
      <p className={styles.note}>Paid skills answer with HTTP 402 and a <code>WWW-Authenticate: Payment</code> challenge, the same flow as the <a href="#payments">REST API</a>.</p>

      <Raw title="Agent card" data={card} file={CARD_PATH} />
    </section>
  );
}

// ---------------------------------------------------------------- OpenAPI
function OpenApiSection({ spec, base }: { spec: J; base: string }) {
  const specUrl = `${base}/openapi.json`;
  const ops = spec ? Object.values<J>(spec.paths ?? {}).reduce((n, p) => n + ["get", "post", "put", "patch", "delete"].filter((m) => p[m]).length, 0) : null;
  return (
    <section className={styles.section} id="openapi-spec" data-spy>
      <span className={styles.eyebrow}>OpenAPI 3.1</span>
      <h2 className={styles.h2}>OpenAPI specification</h2>
      <p className={styles.p}>The machine-readable contract behind this reference: every endpoint with parameters, schemas, examples, auth and payment metadata. Import it into your API client, generate a typed SDK, or hand it to an LLM agent as its tool definition.</p>

      <div className={styles.facts}>
        <Fact label="Spec URL"><Endpoint url={specUrl} /></Fact>
        <Fact label="Version"><b>{spec?.info?.version ? `v${spec.info.version}` : "…"} · OpenAPI {spec?.openapi ?? "3.1"}</b></Fact>
        <Fact label="Operations"><b>{ops ?? "…"} in {spec?.tags?.length ?? "…"} groups</b></Fact>
        <Fact label="Also"><span className={styles.links}><a href="/docs">API documentation</a><a href="/openapi.json">OpenAPI</a></span></Fact>
      </div>
      <div className={styles.buttons}>
        <a className={styles.btnPrimary} href="/openapi.json" download="shadowgraph-openapi.json">Download openapi.json</a>
        <a className={styles.btn} href="/openapi.json" target="_blank" rel="noreferrer">Open raw</a>
      </div>

      <h3 className={styles.h3}>Use it with</h3>
      <TabbedCode tabs={[
        { label: "Postman", code: `Import → Link → paste:\n${specUrl}\n\n# Postman creates a collection with every endpoint and example.` },
        { label: "Insomnia", code: `Create → Import → From URL:\n${specUrl}` },
        { label: "TypeScript types", file: "openapi-typescript", code: `npx openapi-typescript ${specUrl} -o shadowgraph.d.ts` },
        { label: "Python client", file: "openapi-generator", code: `npx @openapitools/openapi-generator-cli generate \\\n  -i ${specUrl} \\\n  -g python \\\n  -o shadowgraph-client` },
        { label: "LLM agents", code: `# Agents read the spec directly; start with the x-guidance field:\ncurl -s ${specUrl} | jq '.info["x-guidance"]'` },
      ]} />

      <Raw title="Full specification" data={spec} file="/openapi.json" />
    </section>
  );
}

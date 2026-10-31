import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { SITE_URL } from "../helpers/site";
import { CodeBlock, CopyButton, TabbedCode } from "../components/DocsCode";
import { AgentInterfaces } from "../components/AgentInterfaces";
import styles from "./docs.module.css";

/**
 * Human-readable API reference. The static guide (auth, payments, limits, errors) renders on the server; the endpoint
 * reference is generated in the browser from /openapi.json, so the spec stays the single source of truth.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
type Op = { id: string; method: string; path: string; op: J; tag: string };
type Field = { name: string; type: string; required: boolean; desc?: string; values?: string[]; depth: number };

const METHOD_CLASS: Record<string, string> = { get: styles.get, post: styles.post };
const GUIDE: Array<[string, string]> = [
  ["overview", "Overview"], ["quickstart", "Quick start"], ["auth", "Authentication"], ["payments", "Machine payments"],
  ["limits", "Rate limits & caching"], ["errors", "Errors"], ["semantics", "Data semantics"],
];
const AGENT_NAV: Array<[string, string, string]> = [
  ["mcp-server", "MCP server", "MCP"], ["a2a-agent", "A2A agent", "A2A"], ["openapi-spec", "OpenAPI spec", "OAS"],
];

// ---------- spec helpers ----------
function resolve(spec: J, s: J): J {
  let cur = s, guard = 0;
  while (cur && cur.$ref && guard++ < 8) {
    cur = String(cur.$ref).replace(/^#\//, "").split("/").reduce((o: J, k: string) => (o ? o[k] : undefined), spec);
  }
  return cur;
}
function merged(spec: J, s: J): J {
  const r = resolve(spec, s);
  if (!r || !r.allOf) return r ?? {};
  const out: J = { ...r, properties: { ...(r.properties ?? {}) }, required: [...(r.required ?? [])] };
  for (const part of r.allOf) {
    const p = merged(spec, part);
    Object.assign(out.properties, p.properties ?? {});
    out.required.push(...(p.required ?? []));
    if (!out.description && p.description) out.description = p.description;
  }
  delete out.allOf;
  return out;
}
function typeLabel(spec: J, raw: J): string {
  const p = merged(spec, raw);
  if (p.const !== undefined) return JSON.stringify(p.const);
  const types: string[] = Array.isArray(p.type) ? p.type : p.type ? [p.type] : p.properties ? ["object"] : [];
  const nullable = types.includes("null");
  let base = types.filter((t) => t !== "null").join(" | ") || "any";
  if (base === "array") {
    const it = merged(spec, p.items ?? {});
    base = `${it.properties ? "object" : typeLabel(spec, p.items ?? {})}[]`;
  }
  if (p.format) base += ` (${p.format})`;
  return nullable ? `${base} · nullable` : base;
}
function flatten(spec: J, schema: J, depth = 0, prefix = "", out: Field[] = []): Field[] {
  const s = merged(spec, schema);
  const req = new Set<string>(s.required ?? []);
  for (const [k, raw] of Object.entries<J>(s.properties ?? {})) {
    const p = merged(spec, raw);
    const name = prefix + k;
    out.push({ name, type: typeLabel(spec, raw), required: req.has(k), desc: p.description, values: p.enum?.map(String), depth });
    if (depth >= 2) continue;
    if (p.properties) flatten(spec, p, depth + 1, `${name}.`, out);
    else if (p.items) { const it = merged(spec, p.items); if (it.properties) flatten(spec, it, depth + 1, `${name}[].`, out); }
  }
  return out;
}
function examplesOf(media: J): Array<[string, J]> {
  if (!media) return [];
  if (media.example !== undefined) return [["Example", media.example]];
  return Object.entries<J>(media.examples ?? {}).map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), v?.value]);
}
function paramDefault(spec: J, raw: J): string {
  const p = resolve(spec, raw);
  const v = p.example ?? p.schema?.example ?? p.schema?.default ?? (p.required ? p.schema?.enum?.[0] : undefined);
  return v === undefined ? "" : String(v);
}
function authOf(spec: J, op: J): "datasetKey" | "mpp" | null {
  const s = (op.security ?? [])[0];
  if (!s) return null;
  return Object.keys(s)[0] === "mpp" ? "mpp" : "datasetKey";
}
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---------- rendering helpers ----------
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s)]+[^\s).,;])|(`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] && m[1].includes("{")) out.push(<code key={i++}>{m[1].replace(/^https?:\/\//, "")}</code>);
    else if (m[1]) out.push(<a key={i++} href={m[1].replace("https://shadowalpha.online", "") || "/"}>{m[1].replace(/^https?:\/\//, "")}</a>);
    else out.push(<code key={i++}>{m[2].slice(1, -1)}</code>);
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return out;
}
function Prose({ text }: { text?: string }) {
  if (!text) return null;
  return <>{text.split(/\n\n+/).map((p, i) => <p key={i} className={styles.p}>{linkify(p)}</p>)}</>;
}

// ---------- code samples ----------
function samples(base: string, method: string, path: string, query: Array<[string, string]>, body: J, auth: string | null, csv: boolean) {
  const qs = query.length ? `?${query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
  const url = `${base}${path}${qs}`;
  const isPost = method === "post";
  const headers: Array<[string, string]> = [];
  if (auth === "datasetKey") headers.push(["Authorization", "Bearer $SHADOWGRAPH_KEY"]);
  if (isPost) headers.push(["Content-Type", "application/json"]);
  const bodyJson = body === undefined ? undefined : JSON.stringify(body);

  const curlCmd = (extra: string[], flags: string) => [`curl ${flags}${isPost ? " -X POST" : ""} "${url}"`,
    ...headers.map(([k, v]) => `-H "${k}: ${v}"`), ...extra,
    ...(bodyJson ? [`-d '${bodyJson}'`] : []),
    ...(path === "/_api/radar/status" ? ["--compressed"] : [])].join(" \\\n  ");
  const curl = auth === "mpp"
    ? ["# 1) Unpaid call: HTTP 402 with a WWW-Authenticate: Payment challenge", curlCmd([], "-si"), "", "# 2) After paying the challenge: retry the identical request with the credential", curlCmd(['-H "Authorization: Payment $MPP_CREDENTIAL"'], "-s")].join("\n")
    : curlCmd([], "-s");

  const jsHeaders = headers.map(([k, v]) => `"${k}": ${v.includes("$") ? `\`${v.replace("$SHADOWGRAPH_KEY", "${process.env.SHADOWGRAPH_KEY}")}\`` : `"${v}"`}`);
  const jsOpts = [
    ...(isPost ? ['method: "POST"'] : []),
    ...(jsHeaders.length ? [`headers: { ${jsHeaders.join(", ")} }`] : []),
    ...(body !== undefined ? [`body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, "\n  ")})`] : []),
  ];
  const js = [
    `const res = await fetch("${url}"${jsOpts.length ? `, {\n  ${jsOpts.join(",\n  ")}\n}` : ""});`,
    ...(auth === "mpp" ? ['if (res.status === 402) {', '  const challenge = res.headers.get("WWW-Authenticate"); // pay, then retry with Authorization: Payment <credential>', "}"] : []),
    `const data = await res.${csv ? "text" : "json"}();`,
    "console.log(data);",
  ].join("\n");

  const pyHeaders = headers.filter(([k]) => k !== "Content-Type").map(([k, v]) => `"${k}": ${v.includes("$") ? 'f"Bearer {os.environ[\'SHADOWGRAPH_KEY\']}"' : `"${v}"`}`);
  const pyArgs = [
    `"${url}"`,
    ...(pyHeaders.length ? [`headers={${pyHeaders.join(", ")}}`] : []),
    ...(body !== undefined ? [`json=${JSON.stringify(body).replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None")}`] : []),
    "timeout=30",
  ];
  const py = [
    ...(auth === "datasetKey" ? ["import os"] : []),
    "import requests",
    "",
    `r = requests.${isPost ? "post" : "get"}(${pyArgs.join(", ")})`,
    ...(auth === "mpp" ? ['if r.status_code == 402:', '    challenge = r.headers["WWW-Authenticate"]  # pay, then retry with Authorization: Payment <credential>'] : []),
    `print(r.${csv ? "text" : "json()"})`,
  ].join("\n");
  return { curl, js, py };
}

// ---------- operation ----------
function Operation({ spec, o, base }: { spec: J; o: Op; base: string }) {
  const { op, method, path } = o;
  const params: J[] = (op.parameters ?? []).map((p: J) => resolve(spec, p));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, paramDefault(spec, p)])));
  const reqMedia = op.requestBody?.content?.["application/json"];
  const reqExamples = examplesOf(reqMedia);
  const [exIdx, setExIdx] = useState(0);
  const auth = authOf(spec, op);
  const responses = Object.entries<J>(op.responses ?? {});
  const okResp = responses.find(([c]) => c.startsWith("2"))?.[1];
  const okMediaType = okResp?.content ? Object.keys(okResp.content)[0] : undefined;
  const okMedia = okMediaType ? okResp.content[okMediaType] : undefined;
  const csv = okMediaType === "text/csv";
  const respExample = examplesOf(okMedia)[0]?.[1];
  const respFields = okMedia?.schema ? flatten(spec, okMedia.schema) : [];
  const reqFields = reqMedia?.schema ? flatten(spec, reqMedia.schema) : [];
  const query = params.filter((p) => p.in === "query" && values[p.name]).map((p) => [p.name, values[p.name]] as [string, string]);
  const code = samples(base, method, path, query, reqExamples[exIdx]?.[1], auth, csv);
  const canTry = method === "get" && !auth;

  const [tryState, setTryState] = useState<{ loading: boolean; status?: number; ms?: number; bytes?: number; body?: string; json?: boolean; error?: string } | null>(null);
  const send = async () => {
    setTryState({ loading: true });
    const t0 = performance.now();
    try {
      const qs = query.length ? `?${query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
      const res = await fetch(`${path}${qs}`, { headers: { Accept: "application/json, text/csv" } });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      let body = text, json = false;
      try { body = JSON.stringify(JSON.parse(text), null, 2); json = true; } catch { /* not JSON */ }
      const limit = 24000;
      if (body.length > limit) body = `${body.slice(0, limit)}\n… truncated in the browser (${(text.length / 1024).toFixed(0)} KB total)`;
      setTryState({ loading: false, status: res.status, ms, bytes: text.length, body, json });
    } catch (e) {
      setTryState({ loading: false, error: e instanceof Error ? e.message : "Request failed" });
    }
  };

  return (
    <article className={styles.op} id={o.id} data-spy>
      <div className={styles.opDocs}>
        <a href={`#${o.id}`} className={styles.opHead}>
          <span className={`${styles.method} ${METHOD_CLASS[method] ?? ""}`}>{method.toUpperCase()}</span>
          <code className={styles.path}>{path}</code>
        </a>
        <h3 className={styles.opTitle}>{op.summary}</h3>
        <div className={styles.badges}>
          {auth === "mpp" ? <span className={styles.badgePaid}>Paid · HTTP 402 / MPP</span> : auth === "datasetKey" ? <span className={styles.badgeKey}>Bearer key</span> : <span className={styles.badgeFree}>Public · no key</span>}
          {op["x-payment-info"]?.price && <span className={styles.badge}>${op["x-payment-info"].price.min}–${op["x-payment-info"].price.max} per call</span>}
          {okMediaType && <span className={styles.badge}>{okMediaType}</span>}
        </div>
        <Prose text={op.description} />

        {params.length > 0 && (
          <section className={styles.block}>
            <h4>Parameters</h4>
            <dl className={styles.fields}>
              {params.map((p) => (
                <div key={p.name} className={styles.field}>
                  <dt><code>{p.name}</code><span className={styles.ftype}>{typeLabel(spec, p.schema ?? {})} · {p.in}</span>{p.required ? <span className={styles.req}>required</span> : <span className={styles.opt}>optional</span>}</dt>
                  <dd>
                    {p.description && <span>{linkify(p.description)}</span>}
                    {p.schema?.enum && <span className={styles.enum}>{p.schema.enum.map((v: string) => <code key={v}>{v}</code>)}</span>}
                    {p.schema?.default !== undefined && <span className={styles.def}>Default <code>{String(p.schema.default)}</code></span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {reqFields.length > 0 && (
          <section className={styles.block}>
            <h4>Request body <span className={styles.muted}>application/json</span></h4>
            <FieldList fields={reqFields} />
          </section>
        )}

        <section className={styles.block}>
          <h4>Responses</h4>
          <ul className={styles.responses}>
            {responses.map(([code, r]) => {
              const media = r.content ? Object.keys(r.content)[0] : null;
              const cls = code.startsWith("2") ? styles.s2 : code === "402" ? styles.s402 : code.startsWith("4") ? styles.s4 : styles.s5;
              return (
                <li key={code}>
                  <span className={`${styles.status} ${cls}`}>{code}</span>
                  <span>{linkify(r.description ?? "")}{media && <span className={styles.muted}> · {media}</span>}
                    {r.headers && Object.entries<J>(r.headers).map(([h, hv]) => <span key={h} className={styles.header}><code>{h}</code> {hv.description}</span>)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {respFields.length > 0 && (
          <details className={styles.block} open={respFields.length <= 14}>
            <summary><h4>Response fields <span className={styles.muted}>{respFields.length}</span></h4></summary>
            <FieldList fields={respFields} />
          </details>
        )}
      </div>

      <div className={styles.opSide}>
        <TabbedCode tabs={[{ label: "cURL", code: code.curl }, { label: "JavaScript", code: code.js }, { label: "Python", code: code.py }]} />
        {reqExamples.length > 1 && (
          <div className={styles.exPick}>Example: {reqExamples.map(([n], i) => <button key={n} type="button" className={i === exIdx ? styles.chipOn : styles.chip} onClick={() => setExIdx(i)}>{n}</button>)}</div>
        )}

        {canTry && (
          <div className={styles.try}>
            <div className={styles.tryHead}><b>Try it</b><span className={styles.muted}>live request from your browser</span></div>
            {params.length > 0 && (
              <div className={styles.tryParams}>
                {params.map((p) => (
                  <label key={p.name}>
                    <span>{p.name}{p.required && <i>*</i>}</span>
                    {p.schema?.enum ? (
                      <select value={values[p.name]} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>
                        {!p.required && <option value="">—</option>}
                        {p.schema.enum.map((v: string) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : (
                      <input value={values[p.name]} placeholder={String(p.schema?.example ?? "")} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} spellCheck={false} />
                    )}
                  </label>
                ))}
              </div>
            )}
            <button type="button" className={styles.send} onClick={send} disabled={tryState?.loading || params.some((p) => p.required && !values[p.name])}>
              {tryState?.loading ? "Sending…" : "Send request"}
            </button>
            {tryState && !tryState.loading && (
              tryState.error ? <p className={styles.tryErr}>{tryState.error}</p> : (
                <CodeBlock code={tryState.body ?? ""} json={tryState.json}
                  title={<span className={styles.tryMeta}><span className={`${styles.status} ${tryState.status && tryState.status < 300 ? styles.s2 : tryState.status === 402 ? styles.s402 : styles.s4}`}>{tryState.status}</span>{tryState.ms} ms · {((tryState.bytes ?? 0) / 1024).toFixed(1)} KB</span>} />
              )
            )}
          </div>
        )}

        {respExample !== undefined && (!tryState || tryState.loading || canTry === false) && (
          <CodeBlock code={typeof respExample === "string" ? respExample : JSON.stringify(respExample, null, 2)} json={typeof respExample !== "string"}
            title={<span className={styles.tryMeta}><span className={`${styles.status} ${styles.s2}`}>{responses.find(([c]) => c.startsWith("2"))?.[0] ?? "200"}</span>Example response</span>} />
        )}
      </div>
    </article>
  );
}

function FieldList({ fields }: { fields: Field[] }) {
  return (
    <dl className={styles.fields}>
      {fields.map((f) => (
        <div key={f.name} className={styles.field} style={{ paddingLeft: f.depth * 18 }}>
          <dt><code>{f.depth ? <><span className={styles.parent}>{f.name.slice(0, f.name.lastIndexOf(".") + 1)}</span>{f.name.slice(f.name.lastIndexOf(".") + 1)}</> : f.name}</code><span className={styles.ftype}>{f.type}</span>{f.required && <span className={styles.req}>required</span>}</dt>
          {(f.desc || f.values) && <dd>{f.desc && <span>{linkify(f.desc)}</span>}{f.values && <span className={styles.enum}>{f.values.map((v) => <code key={v}>{v}</code>)}</span>}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ---------- page ----------
export default function DocsPage() {
  const [spec, setSpec] = useState<J>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<string>("overview");
  const [base, setBase] = useState("https://shadowalpha.online");
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/openapi.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(setSpec).catch(() => setFailed(true));
  }, []);

  const groups = useMemo(() => {
    if (!spec) return [] as Array<{ tag: J; ops: Op[] }>;
    const ops: Op[] = [];
    for (const [path, item] of Object.entries<J>(spec.paths ?? {})) {
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const op = item[method];
        if (op) ops.push({ id: op.operationId ?? slugOf(`${method}-${path}`), method, path, op, tag: op.tags?.[0] ?? "Other" });
      }
    }
    const tags: J[] = [...(spec.tags ?? [])];
    for (const o of ops) if (!tags.some((t) => t.name === o.tag)) tags.push({ name: o.tag });
    return tags.map((tag) => ({ tag, ops: ops.filter((o) => o.tag === tag.name) })).filter((g) => g.ops.length);
  }, [spec]);

  // Jump to a deep link once the reference has rendered.
  useEffect(() => {
    if (!spec || typeof window === "undefined" || !window.location.hash) return;
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (el) setTimeout(() => el.scrollIntoView(), 50);
  }, [spec]);

  // Scroll spy for the sidebar.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-spy]"));
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive((vis[0].target as HTMLElement).id);
    }, { rootMargin: "-70px 0px -70% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [groups]);

  const q = filter.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, ops: q ? g.ops.filter((o) => `${o.path} ${o.op.summary} ${o.tag} ${o.method}`.toLowerCase().includes(q)) : g.ops })).filter((g) => g.ops.length);
  const opCount = groups.reduce((n, g) => n + g.ops.length, 0);
  const publicCount = groups.reduce((n, g) => n + g.ops.filter((o) => !o.op.security?.length).length, 0);
  const servers: J[] = spec?.servers ?? [{ url: "https://shadowalpha.online", description: "Production" }];

  const toc = (
    <nav className={styles.toc} aria-label="API documentation contents">
      <input className={styles.filter} placeholder="Filter endpoints…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter endpoints" spellCheck={false} />
      {!q && (
        <div className={styles.tocGroup}>
          <span className={styles.tocHead}>Guide</span>
          {GUIDE.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? styles.tocOn : undefined}>{label}</a>)}
        </div>
      )}
      {!q && (
        <div className={styles.tocGroup}>
          <span className={styles.tocHead}>Agent interfaces</span>
          {AGENT_NAV.map(([id, label, mini]) => (
            <a key={id} href={`#${id}`} className={active === id ? styles.tocOn : undefined}><span className={`${styles.mini} ${styles.agentMini}`}>{mini}</span>{label}</a>
          ))}
        </div>
      )}
      {shown.map((g) => (
        <div key={g.tag.name} className={styles.tocGroup}>
          <a href={`#tag-${slugOf(g.tag.name)}`} className={styles.tocHead}>{g.tag.name}</a>
          {g.ops.map((o) => (
            <a key={o.id} href={`#${o.id}`} className={active === o.id ? styles.tocOn : undefined}>
              <span className={`${styles.mini} ${METHOD_CLASS[o.method] ?? ""}`}>{o.method === "delete" ? "DEL" : o.method.toUpperCase()}</span>{o.op.summary}
            </a>
          ))}
        </div>
      ))}
      {!spec && !failed && <span className={styles.tocNote}>Loading endpoints…</span>}
      {q && !shown.length && <span className={styles.tocNote}>No endpoint matches “{filter}”.</span>}
    </nav>
  );

  return (
    <>
      <Helmet>
        <title>API documentation · ShadowGraph</title>
        <meta name="description" content="ShadowGraph API reference: live status for 3,000+ internet services, infrastructure dependencies, vendor risk scans, open outage data, MCP/A2A agent interfaces and pay-per-call machine intelligence over HTTP 402." />
        <meta property="og:title" content="ShadowGraph API documentation" />
        <meta property="og:description" content="ShadowGraph API reference: live status for 3,000+ internet services, infrastructure dependencies, vendor risk scans, open outage data, MCP/A2A agent interfaces and pay-per-call machine intelligence over HTTP 402." />
        <link rel="canonical" href={`${SITE_URL}/docs`} />
        <link rel="alternate" type="application/json" href={`${SITE_URL}/openapi.json`} title="OpenAPI 3.1" />
      </Helmet>
      <SiteHeader active="developers" />
      <div className={styles.page}>
        <aside className={styles.side}>{toc}</aside>
        <main className={styles.main} ref={mainRef}>
          <details className={styles.mobileToc}><summary>Contents · {opCount || "…"} endpoints</summary>{toc}</details>

          <header className={styles.hero} id="overview" data-spy>
            <span className={styles.eyebrow}>Developers · API reference {spec?.info?.version ? `v${spec.info.version}` : ""}</span>
            <h1 className={styles.h1}>ShadowGraph API</h1>
            <p className={styles.lead}>Live status, infrastructure dependencies and outage research for about 3,200 internet services: APIs, SaaS, banks, the most-visited websites and cloud regions. The API returns the same data the website shows, as JSON, and most of it needs no key.</p>
            <div className={styles.facts}>
              <div><span>Base URL</span>
                <span className={styles.baseRow}>
                  <select value={base} onChange={(e) => setBase(e.target.value)} aria-label="Server">{servers.map((s) => <option key={s.url} value={s.url}>{s.url.replace("https://", "")}</option>)}</select>
                  <CopyButton text={base} />
                </span>
              </div>
              <div><span>Format</span><b>JSON (CSV where noted), UTC ISO 8601</b></div>
              <div><span>Auth</span><b>{opCount ? `None for ${publicCount} of ${opCount} endpoints` : "None for almost every endpoint"}</b></div>
              <div><span>Freshness</span><b>Probes every 5 min · worldwide re-check every 30 min</b></div>
            </div>
            <div className={styles.heroLinks}>
              <a href="#quickstart" className={styles.btnPrimary}>Quick start</a>
              <a href="#mcp-server" className={styles.btn}><span className={styles.btnTag}>MCP</span>Connect your agent</a>
              <a href="#a2a-agent" className={styles.btn}><span className={styles.btnTag}>A2A</span>Agent card</a>
              <a href="#openapi-spec" className={styles.btn}><span className={styles.btnTag}>OAS</span>OpenAPI 3.1</a>
            </div>
          </header>

          <section className={styles.guide} id="quickstart" data-spy>
            <h2 className={styles.h2}>Quick start</h2>
            <p className={styles.p}>Three calls answer most questions. No sign-up, no key.</p>
            <ol className={styles.steps}>
              <li><b>Find the service.</b> Search by name, domain, provider or cloud region. Every service result carries a <code>slug</code> and its live <code>state</code>.
                <CodeBlock className={styles.stepCode} code={`curl -s "${base}/_api/search?q=stripe&quick=1"`} /></li>
              <li><b>Ask whether it is down.</b> The status page returns the live state per endpoint, since when it fails, the last outage and what it runs on.
                <CodeBlock className={styles.stepCode} code={`curl -s "${base}/_api/status/page?slug=stripe-api"`} /></li>
              <li><b>Check whether it is only regional.</b> Failures are re-checked from six continents every 30 minutes.
                <CodeBlock className={styles.stepCode} code={`curl -s "${base}/_api/radar/global" | jq '.regionalOutages'`} /></li>
            </ol>
          </section>

          <section className={styles.guide} id="auth" data-spy>
            <h2 className={styles.h2}>Authentication</h2>
            <p className={styles.p}>Almost everything is public. Two endpoints need credentials; the website never asks you for an account to read data.</p>
            <div className={styles.table}>
              <div className={styles.tr}><b>Public</b><span>No header needed.</span><span>Every endpoint not listed below.</span></div>
              <div className={styles.tr}><b>Dataset key</b><span><code>Authorization: Bearer sgd_…</code></span><span><a href="#getDependencyDataset">GET /_api/dataset/full</a>. Key issued after subscribing on <a href="/data">/data</a>.</span></div>
              <div className={styles.tr}><b>Machine payment</b><span><code>Authorization: Payment &lt;credential&gt;</code></span><span><a href="#purchaseIntelligence">POST /_api/machine/intelligence</a>, paid MCP tools and paid A2A skills. Pay per call, no account.</span></div>
            </div>
          </section>

          <section className={styles.guide} id="payments" data-spy>
            <h2 className={styles.h2}>Machine payments (HTTP 402)</h2>
            <p className={styles.p}>Paid intelligence uses the open <a href="https://paymentauth.org">Machine Payments Protocol</a> with Stripe as the payment method. Prices are $0.50 to $5.00 per call. Nothing is charged unless your client presents a valid credential for a challenge we issued.</p>
            <ol className={styles.flow}>
              <li><span>1</span><div><b>Call without credentials.</b> The response is <code>402 Payment Required</code> with a <code>WWW-Authenticate: Payment</code> header (method <code>stripe</code>, intent <code>charge</code>, the amount in cents in the base64url <code>request</code> parameter) and an RFC 9457 problem body.</div></li>
              <li><span>2</span><div><b>Pay the challenge.</b> Your agent's wallet creates a Stripe shared payment token for exactly that amount and builds the credential.</div></li>
              <li><span>3</span><div><b>Retry the identical request</b> with <code>Authorization: Payment &lt;base64url credential&gt;</code>. On success you get <code>200</code>, the result and a <code>Payment-Receipt</code> header. A failed payment returns a fresh challenge.</div></li>
            </ol>
            <p className={styles.p}><b>Over MCP</b> the same flow uses JSON-RPC: an unpaid <code>tools/call</code> returns error <code>-32042</code> with <code>error.data.challenges</code>; retry with the credential in <code>params._meta["org.paymentauth/credential"]</code>; the receipt arrives in <code>result._meta["org.paymentauth/receipt"]</code>. Error <code>-32043</code> means the payment could not be verified.</p>
            <CodeBlock code={`HTTP/1.1 402 Payment Required\nWWW-Authenticate: Payment id="…", realm="shadowalpha.online", method="stripe", intent="charge", request="eyJhbW91bnQiOiI1MCIsImN1cnJlbmN5IjoidXNkIn0", expires="…"\nContent-Type: application/problem+json\n\n{ "type": "https://paymentauth.org/problems/payment-required", "title": "Payment Required", "status": 402 }`} title="402 response" />
          </section>

          <section className={styles.guide} id="limits" data-spy>
            <h2 className={styles.h2}>Rate limits &amp; caching</h2>
            <ul className={styles.list}>
              <li>Data changes every 5 minutes. Please poll an endpoint at most <b>once per minute</b>.</li>
              <li>Responses are cached at the edge for 20 seconds to 5 minutes; read <code>Cache-Control</code>. Repeated calls inside that window are cheap and return the same data.</li>
              <li>Live domain scans in <a href="#search">search</a>: 30 per client per hour (<code>quick=1</code> never scans). Vendor scans: 4 per client per hour, 40 per hour in total.</li>
              <li>The full radar is about 1.3 MB of JSON; send <code>Accept-Encoding: gzip</code> (about 90 KB on the wire).</li>
              <li>Exceeding a limit returns <code>429</code> with a JSON error. There is no penalty beyond that.</li>
            </ul>
          </section>

          <section className={styles.guide} id="errors" data-spy>
            <h2 className={styles.h2}>Errors</h2>
            <p className={styles.p}>Errors are JSON objects with one human-readable field: <code>{`{ "error": "…" }`}</code>. Payment errors use <code>application/problem+json</code>.</p>
            <div className={`${styles.table} ${styles.errTable}`}>
              {([["200", "OK", "Data returned. Check status fields such as warming_up after deploys."], ["400", "Bad request", "Missing or invalid parameter, e.g. a search query under 2 characters."], ["401", "Unauthorized", "Missing or invalid dataset key."], ["402", "Payment required", "Paid endpoint called without a valid payment credential. Read WWW-Authenticate."], ["404", "Not found", "Unknown or expired scan id."], ["429", "Too many requests", "Rate limit reached; retry later."], ["503", "Unavailable", "Live data temporarily unavailable, e.g. during a database failover. Retry after a minute."]] as const).map(([c, t, d]) => (
                <div key={c} className={styles.tr}><span className={`${styles.status} ${c.startsWith("2") ? styles.s2 : c === "402" ? styles.s402 : c.startsWith("4") ? styles.s4 : styles.s5}`}>{c}</span><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
          </section>

          <section className={styles.guide} id="semantics" data-spy>
            <h2 className={styles.h2}>Data semantics</h2>
            <dl className={styles.sem}>
              <div><dt><code>up</code></dt><dd>Answered the latest check with HTTP below 500. 401, 403 and 404 count as reachable: the service is there, it just wants a key or another path.</dd></div>
              <div><dt><code>degraded</code></dt><dd>Failed the latest check only. Often a blip; we do not call it an outage yet.</dd></div>
              <div><dt><code>down</code></dt><dd>Failed the latest two checks in a row (about 10 minutes).</dd></div>
              <div><dt><code>unknown</code></dt><dd>Not checked in the last 30 minutes.</dd></div>
              <div><dt>Provider incident</dt><dd>Several independent services in the same hosting provider, cloud region, CDN or DNS provider down at the same time. When more than half of all probes fail at once, our node is suspect and no incidents are opened.</dd></div>
              <div><dt>Vantage point</dt><dd>One measurement node in AWS us-east-1 (N. Virginia), plus six worldwide probes every 30 minutes. A service can be down for you and up for us, or the other way round.</dd></div>
              <div><dt>inferred / statistical</dt><dd>Hypotheses, not proof. Official facts (SEC filings, published IP ranges) are labelled official.</dd></div>
            </dl>
          </section>

          <AgentInterfaces spec={spec} base={base} />

          {failed && <p className={styles.fail}>The endpoint reference could not be loaded. The full specification is at <a href="/openapi.json">/openapi.json</a>.</p>}
          {!spec && !failed && <div className={styles.loading}>Loading endpoint reference…</div>}

          {shown.map((g) => (
            <section key={g.tag.name} className={styles.tagSection}>
              <header className={styles.tagHead} id={`tag-${slugOf(g.tag.name)}`}>
                <span className={styles.eyebrow}>{g.ops.length} endpoint{g.ops.length === 1 ? "" : "s"}</span>
                <h2 className={styles.h2}>{g.tag.name}</h2>
                {g.tag.description && <p className={styles.p}>{linkify(g.tag.description)}</p>}
              </header>
              {g.ops.map((o) => <Operation key={o.id} spec={spec} o={o} base={base} />)}
            </section>
          ))}
        </main>
      </div>
      <SiteFooter />
    </>
  );
}

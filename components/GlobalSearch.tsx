import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { getSearch, type OutputType } from "../endpoints/search_GET.schema";
import { dependencyLine } from "../helpers/companySearchRank";
import styles from "./GlobalSearch.module.css";

type Item = { href: string; label: string; meta: string; group: string };

const STATE_LABEL: Record<string, string> = { up: "up", degraded: "errors", down: "down", unknown: "—" };

function itemsOf(r: OutputType | null, q: string): Item[] {
  if (!r) return [];
  const out: Item[] = [];
  // company dependency pages first: typing a company name or ticker should land on its customers and suppliers
  for (const c of (r.companyPages ?? []).slice(0, 4)) out.push({ group: "Company dependencies", href: `/company/${c.slug}`, label: `${c.name}${c.ticker && /^[A-Z.]{1,6}$/.test(c.ticker) ? ` (${c.ticker})` : ""}`, meta: dependencyLine(c) });
  for (const s of r.services.slice(0, 5)) out.push({ group: "Services", href: `/status/${s.slug}`, label: s.name, meta: `${STATE_LABEL[s.state] ?? s.state}${s.hosting ? ` · ${s.hosting}` : ""}` });
  for (const p of r.providers.slice(0, 4)) out.push({ group: "Providers", href: p.slug ? `/status/${p.slug}` : `/search?q=${encodeURIComponent(p.name)}`, label: p.name, meta: `${p.layers.join(", ")} for ${p.services} services` });
  for (const g of r.regions.slice(0, 3)) out.push({ group: "Cloud regions", href: `/search?q=${encodeURIComponent(g.region)}`, label: `${g.label} (${g.region})`, meta: `${g.services} services` });
  if (!r.companyPages?.length) for (const c of r.companies.slice(0, 3)) out.push({ group: "Revenue dependencies", href: `/company/${c.ticker.toLowerCase()}`, label: `${c.ticker} → ${c.customer}`, meta: `${Math.round(c.share * 100)}% of revenue` });
  out.push({ group: "", href: `/search?q=${encodeURIComponent(q)}`, label: `All results for “${q}”`, meta: "incidents, agents, live lookup" });
  return out;
}

/** Site-wide search in the header: services, providers, regions, companies, domains. Enter opens the full result page. */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<OutputType | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/search") setQ(new URLSearchParams(window.location.search).get("q") ?? "");
  }, []);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      getSearch(t, true, ctrl.signal).then((r) => { setRes(r); setActive(-1); }).catch(() => undefined).finally(() => setLoading(false));
    }, 220);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "")) { e.preventDefault(); setMobileOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  const items = useMemo(() => itemsOf(res, q.trim()), [res, q]);
  const go = (href: string) => { window.location.href = href; };
  const submit = () => { const t = q.trim(); if (t.length >= 2) go(`/search?q=${encodeURIComponent(t)}`); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && items[active]) go(items[active].href); else submit(); }
    else if (e.key === "Escape") { setOpen(false); setMobileOpen(false); inputRef.current?.blur(); }
  };

  let lastGroup = "";
  return (
    <div ref={wrapRef} className={`${styles.wrap} ${mobileOpen ? styles.mobileOpen : ""}`}>
      <button type="button" className={styles.iconBtn} aria-label="Search" onClick={() => { setMobileOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}><Search size={16} /></button>
      <form className={styles.form} role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Search size={14} className={styles.glass} aria-hidden="true" />
        <input
          ref={inputRef} id="global-search" className={styles.input} type="search" autoComplete="off" spellCheck={false}
          placeholder="Company, provider, region, domain…" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          role="combobox" aria-expanded={open && items.length > 0} aria-controls="global-search-list" aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `gs-${active}` : undefined}
        />
        <kbd className={styles.kbd} aria-hidden="true">/</kbd>
        <button type="button" className={styles.close} aria-label="Close search" onClick={() => { setMobileOpen(false); setOpen(false); }}><X size={16} /></button>
      </form>
      {open && q.trim().length >= 2 && (
        <div className={styles.panel} id="global-search-list" role="listbox" aria-label="Search suggestions">
          {loading && !res && <div className={styles.empty}>Searching…</div>}
          {res && items.length === 1 && <div className={styles.empty}>Nothing in the monitored services, providers or filings. Press Enter for incidents, agents and a live domain lookup.</div>}
          {items.map((it, i) => {
            const head = it.group && it.group !== lastGroup ? <div className={styles.group} key={`g-${it.group}`}>{it.group}</div> : null;
            lastGroup = it.group || lastGroup;
            return (
              <div key={`${it.href}-${i}`}>
                {head}
                <a id={`gs-${i}`} role="option" aria-selected={active === i} href={it.href} className={`${styles.item} ${active === i ? styles.itemActive : ""} ${it.group ? "" : styles.all}`} onMouseEnter={() => setActive(i)}>
                  <span className={styles.label}>{it.label}</span><span className={styles.meta}>{it.meta}</span>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

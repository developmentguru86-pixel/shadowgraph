import { useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getCompanyIndex } from "../endpoints/company/index_GET.schema";
import { rankCompanies, dependencyLine } from "../helpers/companySearchRank";
import styles from "./CompanySearch.module.css";

/**
 * Type a company name or ticker, pick a result, land on its dependency page. The company index loads on first focus
 * (it is already in the cache on /companies), so the box costs nothing until someone uses it.
 */
export function CompanySearch({ size = "large", autoFocus, placeholder = "Search a company or ticker, e.g. Apple, NVDA, Walmart" }: {
  size?: "large" | "compact"; autoFocus?: boolean; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState(!!autoFocus);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idx = useQuery({ queryKey: ["company-index"], queryFn: getCompanyIndex, staleTime: 3600_000, enabled: wanted });
  const results = useMemo(() => rankCompanies(idx.data?.companies ?? [], q, 8), [idx.data, q]);
  const go = (slug: string) => { window.location.href = `/company/${slug}`; };
  const showPanel = open && q.trim().length >= 1;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const hit = results[active] ?? results[0]; if (hit) go(hit.slug); else if (q.trim().length >= 2) window.location.href = `/search?q=${encodeURIComponent(q.trim())}`; }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div className={`${styles.wrap} ${size === "compact" ? styles.compact : ""}`} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <form role="search" className={styles.form} onSubmit={(e) => e.preventDefault()}>
        <Search size={size === "compact" ? 15 : 19} className={styles.glass} aria-hidden="true" />
        <input
          ref={inputRef} className={styles.input} type="search" autoComplete="off" spellCheck={false} autoFocus={autoFocus}
          placeholder={placeholder} value={q} aria-label="Search company dependencies"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); setWanted(true); }}
          onFocus={() => { setWanted(true); setOpen(true); }} onKeyDown={onKeyDown}
          role="combobox" aria-expanded={showPanel && results.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showPanel && results[active] ? `${listId}-${active}` : undefined}
        />
      </form>
      {showPanel && (
        <div className={styles.panel} id={listId} role="listbox" aria-label="Companies">
          {idx.isLoading && <div className={styles.empty}>Loading companies…</div>}
          {idx.data && results.length === 0 && (
            <div className={styles.empty}>
              No company called “{q.trim()}” in the major-customer disclosures of SEC annual reports. Companies appear here only if they, or one of their suppliers, name a customer worth 10% or more of revenue.
              {q.trim().length >= 2 && <> <a href={`/search?q=${encodeURIComponent(q.trim())}`}>Search the whole site</a>.</>}
            </div>
          )}
          {results.map((c, i) => (
            <a key={c.slug} id={`${listId}-${i}`} role="option" aria-selected={active === i} href={`/company/${c.slug}`}
              className={`${styles.item} ${active === i ? styles.itemActive : ""}`} onMouseEnter={() => setActive(i)}>
              <span className={styles.name}>{c.name}{c.ticker && /^[A-Z.]{1,6}$/.test(c.ticker) && <span className={styles.ticker}>{c.ticker}</span>}</span>
              <span className={styles.meta}>{dependencyLine(c)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

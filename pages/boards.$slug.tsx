import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { StatusBoard } from "../components/StatusBoard";
import { getBoardPreview } from "../endpoints/board/preview_GET.schema";
import { templateBySlug, DEFAULT_SLA } from "../helpers/boardTemplates";
import { SITE_URL } from "../helpers/site";
import styles from "./boards.$slug.module.css";

/** Public example board, full screen, with a slim bar that leads to the builder. */
export default function TemplateBoardPage() {
  const { slug = "" } = useParams();
  const t = templateBySlug(slug);
  const q = useQuery({
    queryKey: ["board-template", slug], enabled: !!t, refetchInterval: 60_000, staleTime: 30_000,
    queryFn: () => getBoardPreview({ ids: t!.serviceIds, title: t!.title, accent: t!.accent, theme: t!.theme, sla: t!.sla ?? DEFAULT_SLA }),
  });
  if (!t) return <main className={styles.missing}><h1>No such example board</h1><p><a href="/boards">See all status boards</a></p></main>;
  const title = `${t.title}: is ${t.name} down right now?`;
  return (
    <>
      <Helmet>
        <title>{`${title} · ShadowGraph`}</title>
        <meta name="description" content={`Live status of ${t.name}: ${t.blurb} Checked every 5 minutes, with provider incidents.`} />
        <link rel="canonical" href={`${SITE_URL}/boards/${t.slug}`} />
        <meta property="og:title" content={title} />
      </Helmet>
      <div className={styles.bar}>
        <span>Example status board by <a href="/">ShadowGraph</a></span>
        <a href={`/boards?t=${t.slug}`} className={styles.make}>Make it your own</a>
      </div>
      {q.data ? <StatusBoard board={q.data} /> : <main className={styles.missing}><p>{q.isError ? "The board is unavailable right now." : "Loading status…"}</p></main>}
    </>
  );
}
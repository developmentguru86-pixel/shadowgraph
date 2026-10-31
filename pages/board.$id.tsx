import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { StatusBoard } from "../components/StatusBoard";
import { getBoard } from "../endpoints/board_GET.schema";
import styles from "./board.$id.module.css";

/** Public, unlisted white-label status board. No ShadowGraph chrome: the board belongs to its owner. */
export default function BoardPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["board", id], queryFn: () => getBoard(id), refetchInterval: 60_000, retry: false, staleTime: 30_000 });
  return (
    <>
      <Helmet>
        <title>{q.data ? `${q.data.title} · Status` : "Status"}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      {q.data ? <StatusBoard board={q.data} /> : (
        <main className={styles.empty}>
          {q.isLoading ? <p>Loading status…</p> : <><h1>This status board is not available</h1><p>The link may be wrong, or the board was switched off by its owner.</p></>}
        </main>
      )}
    </>
  );
}
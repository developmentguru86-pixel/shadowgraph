import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { StatusBoard } from "../components/StatusBoard";
import { getBoard } from "../endpoints/board_GET.schema";
import styles from "./embed.board.$id.module.css";

/** Compact board for an iframe on the owner's intranet or client portal. */
export default function EmbedBoardPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["board", id], queryFn: () => getBoard(id), refetchInterval: 60_000, retry: false, staleTime: 30_000 });
  return (
    <>
      <Helmet><title>Status</title><meta name="robots" content="noindex, nofollow" /></Helmet>
      {q.data ? <StatusBoard board={q.data} compact /> : <p className={styles.empty}>{q.isLoading ? "Loading status…" : "Status board not available."}</p>}
    </>
  );
}
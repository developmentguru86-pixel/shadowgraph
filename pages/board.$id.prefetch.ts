import type { PagePrefetchFn } from "@runtime/prefetch";
import { statusBoards } from "../helpers/statusBoards";

// Server-render the board so it shows instantly and works without JavaScript; unknown boards return 404.
export const prefetch: PagePrefetchFn = async ({ qc, url }) => {
  const id = decodeURIComponent(new URL(url, "https://x").pathname.split("/board/")[1]?.split("/")[0] ?? "");
  const b = await statusBoards.publicView(id).catch(() => null);
  if (!b) return { maxAge: 60, statusCode: 404 };
  qc.setQueryData(["board", id], JSON.parse(JSON.stringify(b)));
  return { maxAge: 30 };
};
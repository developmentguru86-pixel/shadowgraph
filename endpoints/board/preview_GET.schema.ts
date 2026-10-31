import type { PublicBoard } from "../../helpers/statusBoards";

export type PreviewParams = { ids: string[]; title?: string; accent?: string; theme?: string; logo?: string; sla?: number | null };

export const getBoardPreview = async (p: PreviewParams): Promise<PublicBoard> => {
  const q = new URLSearchParams({ ids: p.ids.join(","), ...(p.title ? { title: p.title } : {}), ...(p.accent ? { accent: p.accent } : {}), ...(p.theme ? { theme: p.theme } : {}), ...(p.logo ? { logo: p.logo } : {}), ...(p.sla ? { sla: String(p.sla) } : {}) });
  const r = await fetch(`/_api/board/preview?${q}`);
  const j = (await r.json()) as { board?: PublicBoard; error?: string };
  if (!r.ok || !j.board) throw new Error(j.error ?? "Preview unavailable");
  return j.board;
};
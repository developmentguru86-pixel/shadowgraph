import type { PublicBoard } from "../helpers/statusBoards";

export type OutputType = { board?: PublicBoard; error?: string };

export const getBoard = async (id: string): Promise<PublicBoard> => {
  const r = await fetch(`/_api/board?id=${encodeURIComponent(id)}`);
  const j = (await r.json()) as OutputType;
  if (!r.ok || !j.board) throw new Error(j.error ?? "Board unavailable");
  return j.board;
};
import type { signalsBoard } from "../helpers/signalsBoard";

export type OutputType = Awaited<ReturnType<typeof signalsBoard.get>>;

export const getSignalsBoard = async (): Promise<OutputType> => {
  const r = await fetch("/_api/signals_board");
  if (!r.ok) throw new Error("Signals unavailable");
  return r.json();
};
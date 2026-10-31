import type { statusDirectoryData } from "./directory_GET";

export type OutputType = Awaited<ReturnType<typeof statusDirectoryData>>;

export const getStatusDirectory = async (letter: string): Promise<OutputType> => {
  const r = await fetch(`/_api/status/directory?letter=${encodeURIComponent(letter)}`);
  if (!r.ok) throw new Error("Directory unavailable");
  return r.json();
};
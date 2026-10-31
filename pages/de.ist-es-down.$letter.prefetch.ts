import type { PagePrefetchFn } from "@runtime/prefetch";
import { statusDirectoryData } from "../endpoints/status/directory_GET";
import { isDirectoryLetter } from "../helpers/statusLetters";

// Server-render the German A–Z list so crawlers see every link.
export const prefetch: PagePrefetchFn = async ({ qc, url }) => {
  const letter = (new URL(url, "https://x").pathname.split("/").filter(Boolean).pop() ?? "").toLowerCase();
  if (!isDirectoryLetter(letter)) return { statusCode: 404 };
  qc.setQueryData(["status-directory", letter], await statusDirectoryData(letter));
  return { maxAge: 3600 };
};
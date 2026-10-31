/**
 * A–Z directory of the public status pages (/is-it-down/a … /is-it-down/0-9, German under /de/ist-es-down/…).
 * Client-safe: no database access here, see statusIndex() in statusPage.tsx for the data.
 */
export const DIRECTORY_LETTERS = [..."abcdefghijklmnopqrstuvwxyz", "0-9"] as const;
export type DirectoryLetter = (typeof DIRECTORY_LETTERS)[number];

export const isDirectoryLetter = (s: string): s is DirectoryLetter => (DIRECTORY_LETTERS as readonly string[]).includes(s);

/** Bucket of a display name: first letter without accents (Ö → o), anything else → "0-9". */
export function letterOf(name: string): DirectoryLetter {
  const ch = name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().charAt(0).toLowerCase();
  return ch >= "a" && ch <= "z" ? (ch as DirectoryLetter) : "0-9";
}

export const letterLabel = (l: DirectoryLetter) => (l === "0-9" ? "0–9" : l.toUpperCase());
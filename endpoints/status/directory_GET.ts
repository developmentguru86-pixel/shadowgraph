import { statusIndex } from "../../helpers/statusPage";
import { DIRECTORY_LETTERS, isDirectoryLetter } from "../../helpers/statusLetters";

/** Public A–Z directory of status pages: GET /_api/status/directory?letter=a (letters a–z, 0-9). */
export async function statusDirectoryData(letter: string) {
  const all = await statusIndex();
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.letter, (counts.get(e.letter) ?? 0) + 1);
  return {
    letter,
    total: all.length,
    letters: DIRECTORY_LETTERS.map((l) => ({ letter: l, n: counts.get(l) ?? 0 })),
    entries: all.filter((e) => e.letter === letter).map((e) => ({ slug: e.slug, name: e.name })),
  };
}

export async function handle(request: Request) {
  const letter = (new URL(request.url).searchParams.get("letter") ?? "").toLowerCase();
  if (!isDirectoryLetter(letter)) return Response.json({ error: "letter must be a-z or 0-9" }, { status: 400 });
  try {
    return Response.json(await statusDirectoryData(letter), { headers: { "Cache-Control": "public, s-maxage=3600", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Directory unavailable" }, { status: 503 });
  }
}
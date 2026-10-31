import { useParams } from "react-router-dom";
import { StatusAZ } from "../components/StatusAZ";
import { isDirectoryLetter } from "../helpers/statusLetters";

/** A–Z-Verzeichnis der Statusseiten, Deutsch (/de/ist-es-down/a … /de/ist-es-down/0-9). */
export default function StatusDirectoryPageDe() {
  const { letter: raw = "" } = useParams();
  const letter = raw.toLowerCase();
  return <StatusAZ lang="de" letter={isDirectoryLetter(letter) ? letter : "a"} />;
}
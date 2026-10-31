import { useParams } from "react-router-dom";
import { StatusAZ } from "../components/StatusAZ";
import { isDirectoryLetter } from "../helpers/statusLetters";

/** A–Z directory of status pages, English (/is-it-down/a … /is-it-down/0-9). */
export default function StatusDirectoryPage() {
  const { letter: raw = "" } = useParams();
  const letter = raw.toLowerCase();
  return <StatusAZ lang="en" letter={isDirectoryLetter(letter) ? letter : "a"} />;
}
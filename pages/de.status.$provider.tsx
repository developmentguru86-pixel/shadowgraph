import { useParams } from "react-router-dom";
import { StatusView } from "../components/StatusView";

/** "Ist X down?" — German version of /status/:provider (same data, same rules). */
export default function StatusPageDe() {
  const { provider: raw = "" } = useParams();
  return <StatusView slug={decodeURIComponent(raw).toLowerCase()} lang="de" />;
}

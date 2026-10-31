import { useParams } from "react-router-dom";
import { StatusView } from "../components/StatusView";

/** "Is X down?" in English. The German version of the same page lives at /de/status/:provider. */
export default function StatusPage() {
  const { provider: raw = "" } = useParams();
  return <StatusView slug={decodeURIComponent(raw).toLowerCase()} lang="en" />;
}

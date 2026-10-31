import type { IncidentFile } from "../../helpers/doraIncident";
import type { ReportLang } from "../../helpers/doraReportText";

export type OutputType = { monitoring: { hosts: string[]; checks: number; since: string | null }; alertEmail: string | null; incidents: IncidentFile[] };

export const getVendorIncidents = async (id: string, lang: ReportLang): Promise<OutputType> => {
  const r = await fetch(`/_api/vendors/incidents?id=${encodeURIComponent(id)}&lang=${lang}`);
  if (!r.ok) throw new Error("unavailable");
  return r.json();
};
export type { CommercialLead } from "../helpers/leadEngine";
import type { CommercialLead } from "../helpers/leadEngine";

export type OutputType = {
  generatedAt: string;
  methodology: string;
  disclaimer: string;
  leads: CommercialLead[];
};

export const getLeads = async (): Promise<OutputType> => {
  const result = await fetch("/_api/leads");
  if (!result.ok) throw new Error("Lead engine unavailable");
  return result.json();
};
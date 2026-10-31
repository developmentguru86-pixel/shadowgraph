import superjson from "superjson";

export type InfraNode = {
  id: string;
  type: "facility" | "exchange";
  name: string;
  city: string;
  website?: string | null;
};

export type OutputType = {
  fetchedAt: string;
  facilities: InfraNode[];
  exchanges: InfraNode[];
};

export const getInfra = async (): Promise<OutputType> => {
  const result = await fetch("/_api/infra");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
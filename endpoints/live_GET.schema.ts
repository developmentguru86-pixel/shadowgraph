import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});

export type LiveEvent = {
  id: string;
  title: string;
  url: string;
  domain: string;
  seen: string;
  language: string;
  sourceCountry: string;
};

export type InfraNode = {
  id: string;
  type: "facility" | "exchange";
  name: string;
  city: string;
  website?: string | null;
};

export type OutputType = {
  fetchedAt: string;
  events: LiveEvent[];
  facilities: InfraNode[];
  exchanges: InfraNode[];
  sourceHealth: {
    gdelt: "ok" | "degraded";
    peeringdb: "ok" | "degraded";
  };
  warnings: string[];
};

export const getLive = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch("/_api/live", {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
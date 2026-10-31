import type { dependencyAtlas } from "../helpers/dependencyAtlas";
export type OutputType = { generatedAt: string; channels: ReturnType<typeof dependencyAtlas.analyze>; sources: Record<string,string>; eventCount: number; coverage: string };
export async function getDependencyMap(): Promise<OutputType> {
 const response = await fetch("/_api/dependency_map", {signal: AbortSignal.timeout(45000)});
 if (!response.ok) throw new Error("Relationship data is temporarily unavailable");
 return response.json();
}
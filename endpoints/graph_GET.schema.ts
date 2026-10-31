export type { GraphEdge, GraphNode } from "../helpers/relationshipGraphEngine";
import type { GraphEdge, GraphNode } from "../helpers/relationshipGraphEngine";

export type OutputType = {
  generatedAt: string;
  methodology: string;
  disclaimer: string;
  stats: { nodes: number; edges: number; officialEdges: number; inferredEdges: number };
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export const getGraph = async (): Promise<OutputType> => {
  const result = await fetch("/_api/graph");
  if (!result.ok) throw new Error("Relationship graph unavailable");
  return result.json();
};
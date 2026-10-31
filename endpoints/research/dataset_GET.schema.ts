export const DATASET_TABLES = ["services", "sweeps", "episodes", "hourly", "status_incidents", "provider_incidents", "upstream_signals"] as const;
export type DatasetTable = (typeof DATASET_TABLES)[number];
export type OutputType = string; // CSV

export const datasetUrl = (table: DatasetTable, days?: number) =>
  `/_api/research/dataset?table=${table}${days ? `&days=${days}` : ""}`;

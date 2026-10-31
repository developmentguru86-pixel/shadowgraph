/** The endpoint returns a CSV file; link to it directly. */
export const evidenceCsvUrl = (id: string) => `/_api/vendors/evidence_csv?id=${encodeURIComponent(id)}`;

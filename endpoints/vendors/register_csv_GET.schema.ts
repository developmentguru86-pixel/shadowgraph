/** The endpoint returns a CSV file; link to it directly. */
export const registerCsvUrl = (id: string) => `/_api/vendors/register_csv?id=${encodeURIComponent(id)}`;

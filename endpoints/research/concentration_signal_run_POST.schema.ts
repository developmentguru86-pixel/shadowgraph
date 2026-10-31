export type OutputType = { started: boolean; reason?: string };

export const postConcentrationSignalRun = async (): Promise<OutputType> => {
  const r = await fetch("/_api/research/concentration_signal_run", { method: "POST", body: "{}" });
  if (!r.ok) throw new Error("Could not start the test");
  return r.json();
};
export type OutputType = { ok: true };

/** Unsubscribe page button: same endpoint mail providers call for one-click unsubscribe. */
export const postUnsubscribe = async (t: string): Promise<OutputType> => {
  const r = await fetch(`/_api/email/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST" });
  return r.json();
};

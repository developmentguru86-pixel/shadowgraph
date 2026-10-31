import { randomBytes, randomUUID } from "crypto";
import { sql } from "kysely";
import { db } from "./db";
import { planOf } from "./alertPlans";
import { renderBoard, type PublicBoard } from "./boardRender";
export type { PublicBoard, BoardItem, BoardEvent, BoardDependency, DayBar, MonthSla } from "./boardRender";

/**
 * White-label status boards (Team plan): a subscriber publishes up to 5 branded, read-only boards for an internal team
 * or a client, at an unguessable URL (/board/<publicId>) and as an iframe (/embed/board/<publicId>).
 * Content is built by renderBoard (live state, 30-day history, events from three sources, shared dependencies).
 * Own endpoints appear by name only, never by URL. A board goes dark when the subscription is no longer active.
 */
export type BoardInput = {
  id?: string; title: string; logoUrl?: string | null; accent?: string; theme?: "dark" | "light"; note?: string | null;
  serviceIds: string[]; monitorIds: string[]; showPowered?: boolean; slaTarget?: number | null;
};
export type BoardSummary = {
  id: string; publicId: string; title: string; logoUrl: string | null; accent: string; theme: string; note: string | null;
  serviceIds: string[]; monitorIds: string[]; showPowered: boolean; updatedAt: string; slaTarget: number | null;
};

const MAX_ITEMS = 50;
const HEX = /^#[0-9a-fA-F]{6}$/;
export const SLA_TARGETS = [0.995, 0.999, 0.9995, 0.9999];
const cleanSla = (v: number | null | undefined) => (typeof v === "number" && SLA_TARGETS.includes(v) ? v : null);

function cleanLogo(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("Logo must be a full https URL to an image"); }
  if (u.protocol !== "https:") throw new Error("Logo must be served over https");
  if (u.toString().length > 500) throw new Error("Logo URL is too long");
  return u.toString();
}

const rows = (subscriptionId: string) => db.selectFrom("statusBoards").selectAll().where("subscriptionId", "=", subscriptionId).where("active", "=", true).orderBy("createdAt").execute();
const toSummary = (b: Awaited<ReturnType<typeof rows>>[number]): BoardSummary => ({
  id: b.id, publicId: b.publicId, title: b.title, logoUrl: b.logoUrl, accent: b.accent, theme: b.theme, note: b.note,
  serviceIds: b.serviceIds as string[], monitorIds: b.monitorIds as string[], showPowered: b.showPowered, updatedAt: new Date(b.updatedAt).toISOString(), slaTarget: b.slaTarget,
});

export const statusBoards = {
  async list(subscriptionId: string): Promise<BoardSummary[]> {
    return (await rows(subscriptionId)).map(toSummary);
  },

  async save(sub: { id: string; plan: string; status: string }, input: BoardInput): Promise<BoardSummary[]> {
    const plan = planOf(sub.plan);
    if (plan.boards === 0) throw new Error("Status boards are part of the Team plan");
    if (sub.status !== "active") throw new Error("Your subscription is not active");
    const title = input.title.trim().slice(0, 80);
    if (!title) throw new Error("Give the board a title");
    const accent = input.accent && HEX.test(input.accent) ? input.accent.toLowerCase() : "#5fe3a1";
    const theme = input.theme === "light" ? "light" : "dark";
    const note = input.note?.trim().slice(0, 280) || null;
    const want = [...new Set(input.serviceIds)].slice(0, MAX_ITEMS);
    const found = new Set(want.length ? (await db.selectFrom("radarServices").select("id").where("id", "in", want).where("active", "=", true).execute()).map((s) => s.id) : []);
    const services = want.filter((id) => found.has(id)); // keep the owner's order
    const mine = (await db.selectFrom("customMonitors").select("id").where("subscriptionId", "=", sub.id).where("active", "=", true).execute()).map((m) => m.id);
    const monitors = [...new Set(input.monitorIds)].filter((id) => mine.includes(id));
    if (services.length + monitors.length === 0) throw new Error("Add at least one service or endpoint to the board");
    if (services.length + monitors.length > MAX_ITEMS) throw new Error(`A board shows up to ${MAX_ITEMS} items`);
    const values = { title, logoUrl: cleanLogo(input.logoUrl), accent, theme, note, serviceIds: services as never, monitorIds: monitors as never,
      showPowered: input.showPowered !== false, slaTarget: cleanSla(input.slaTarget), updatedAt: sql`now()` as never };
    if (input.id) {
      const r = await db.updateTable("statusBoards").set(values).where("id", "=", input.id).where("subscriptionId", "=", sub.id).where("active", "=", true).executeTakeFirst();
      if (!r.numUpdatedRows) throw new Error("Board not found");
    } else {
      const n = (await rows(sub.id)).length;
      if (n >= plan.boards) throw new Error(`Your plan includes ${plan.boards} boards`);
      await db.insertInto("statusBoards").values({ id: randomUUID(), publicId: randomBytes(9).toString("base64url"), subscriptionId: sub.id, ...values }).execute();
    }
    return this.list(sub.id);
  },

  async remove(subscriptionId: string, id: string): Promise<BoardSummary[]> {
    await db.updateTable("statusBoards").set({ active: false, updatedAt: sql`now()` as never }).where("id", "=", id).where("subscriptionId", "=", subscriptionId).execute();
    return this.list(subscriptionId);
  },

  /** Read-only data behind /board/<publicId>. null when unknown or the subscription lapsed. */
  async publicView(publicId: string): Promise<PublicBoard | null> {
    if (!/^[A-Za-z0-9_-]{8,32}$/.test(publicId)) return null;
    const b = await db.selectFrom("statusBoards as b").innerJoin("alertSubscriptions as s", "s.id", "b.subscriptionId")
      .selectAll("b").select(["s.status as subStatus", "s.plan as subPlan"])
      .where("b.publicId", "=", publicId).where("b.active", "=", true).executeTakeFirst();
    if (!b || b.subStatus !== "active" || planOf(b.subPlan).boards === 0) return null;
    return renderBoard({ title: b.title, logoUrl: b.logoUrl, accent: b.accent, theme: b.theme, note: b.note, showPowered: b.showPowered,
      slaTarget: b.slaTarget, evidenceUrl: `/_api/board/evidence?id=${encodeURIComponent(b.publicId)}` },
      b.serviceIds as string[], b.monitorIds as string[], b.subscriptionId);
  },

  /** Board row for the evidence export (same access rule as publicView). */
  async forEvidence(publicId: string) {
    if (!/^[A-Za-z0-9_-]{8,32}$/.test(publicId)) return null;
    const b = await db.selectFrom("statusBoards as b").innerJoin("alertSubscriptions as s", "s.id", "b.subscriptionId")
      .selectAll("b").select(["s.status as subStatus", "s.plan as subPlan"])
      .where("b.publicId", "=", publicId).where("b.active", "=", true).executeTakeFirst();
    if (!b || b.subStatus !== "active" || planOf(b.subPlan).boards === 0) return null;
    return b;
  },

  /** Live preview for the public board builder and example boards: radar services only (public data), nothing stored. */
  async preview(input: { title?: string; accent?: string; theme?: string; logoUrl?: string | null; note?: string | null; serviceIds: string[]; slaTarget?: number | null }): Promise<PublicBoard> {
    let logo: string | null = null;
    try { logo = cleanLogo(input.logoUrl); } catch { logo = null; }
    return renderBoard({ title: (input.title ?? "").trim().slice(0, 80) || "Service status", logoUrl: logo,
      accent: input.accent && HEX.test(input.accent) ? input.accent.toLowerCase() : "#5fe3a1", theme: input.theme === "light" ? "light" : "dark",
      note: input.note ?? null, showPowered: true, slaTarget: cleanSla(input.slaTarget), evidenceUrl: null }, [...new Set(input.serviceIds)].slice(0, MAX_ITEMS), [], null);
  },
};

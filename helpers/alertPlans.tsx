/** Subscription plans for stack alerts (client-safe constants; checkout and limits read from here). */
export type PlanId = "alerts" | "team";
export type Plan = { id: PlanId; name: string; priceCents: number; priceLabel: string; services: number; monitors: number; boards: number };

export const PLANS: Record<PlanId, Plan> = {
  alerts: { id: "alerts", name: "Stack Alerts", priceCents: 2900, priceLabel: "$29", services: 25, monitors: 10, boards: 0 },
  team: { id: "team", name: "Team", priceCents: 9900, priceLabel: "$99", services: 100, monitors: 25, boards: 5 },
};
export const planOf = (id: string | null | undefined): Plan => PLANS[(id === "team" ? "team" : "alerts") as PlanId];
export const MAX_SERVICES_ANY = PLANS.team.services;

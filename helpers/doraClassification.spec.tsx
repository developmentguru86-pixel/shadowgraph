import { classify, deadlines, type ClassInput } from "./doraClassification";

const base: ClassInput = {
  gate: { criticalFunction: false, regulatedService: false, maliciousAccess: false },
  clients: { relevantAffected: false },
  reputation: { media: false, complaints: false, regulatory: false, lossOfClients: false },
  data: { ciaImpact: false, maliciousDataLoss: false },
};

describe("DORA major incident classification", () => {
  it("needs critical services: two criteria alone are not enough", () => {
    const r = classify({ ...base, durationHours: 30, costsEur: 200_000 });
    expect(r.metCount).toBe(2);
    expect(r.major).toBe(false);
  });
  it("critical services + two criteria = major", () => {
    const r = classify({ ...base, gate: { ...base.gate, criticalFunction: true }, downtimeHours: 3, clients: { total: 1000, affected: 150, relevantAffected: false } });
    expect(r.met.duration.met).toBe(true);
    expect(r.met.clients.met).toBe(true);
    expect(r.major).toBe(true);
  });
  it("critical services + one criterion = not major", () => {
    const r = classify({ ...base, gate: { ...base.gate, regulatedService: true }, downtimeHours: 5 });
    // the 2-hour downtime threshold applies only to services supporting critical or important functions
    expect(r.met.duration.met).toBe(false);
    expect(classify({ ...base, gate: { ...base.gate, criticalFunction: true }, downtimeHours: 5 }).major).toBe(false);
  });
  it("malicious access with possible data loss is major on its own once critical services are affected", () => {
    const r = classify({ ...base, gate: { ...base.gate, maliciousAccess: true }, data: { ciaImpact: false, maliciousDataLoss: true } });
    expect(r.major).toBe(true);
  });
  it("thresholds are strict: exactly 10% or 100,000 clients do not meet the criterion", () => {
    expect(classify({ ...base, clients: { total: 1000, affected: 100, relevantAffected: false } }).met.clients.met).toBe(false);
    expect(classify({ ...base, clients: { affected: 100_000, relevantAffected: false } }).met.clients.met).toBe(false);
    expect(classify({ ...base, costsEur: 100_000 }).met.economic.met).toBe(false);
  });
});

describe("DORA reporting deadlines", () => {
  it("initial = min(classification + 4 h, awareness + 24 h)", () => {
    const aware = new Date(2026, 9, 21, 9, 0), cls = new Date(2026, 9, 22, 7, 0); // Wed 09:00, classified Thu 07:00
    const [ini] = deadlines({ awareAt: aware, classifiedAt: cls, noWeekendRelief: true });
    expect(ini.due.getTime()).toBe(new Date(2026, 9, 22, 9, 0).getTime());
  });
  it("late classification: 4 h from classification", () => {
    const aware = new Date(2026, 9, 20, 9, 0), cls = new Date(2026, 9, 22, 9, 0);
    const [ini] = deadlines({ awareAt: aware, classifiedAt: cls, noWeekendRelief: true });
    expect(ini.due.getTime()).toBe(new Date(2026, 9, 22, 13, 0).getTime());
  });
  it("weekend relief moves a Saturday deadline to Monday noon, but not for credit institutions", () => {
    const aware = new Date(2026, 9, 24, 8, 0), cls = new Date(2026, 9, 24, 9, 0); // Saturday 24 Oct 2026
    expect(deadlines({ awareAt: aware, classifiedAt: cls, noWeekendRelief: false })[0].due.getTime()).toBe(new Date(2026, 9, 26, 12, 0).getTime());
    expect(deadlines({ awareAt: aware, classifiedAt: cls, noWeekendRelief: true })[0].due.getTime()).toBe(new Date(2026, 9, 24, 13, 0).getTime());
  });
});

import type { Json } from "./schema";
import { db } from "./db";

export const mppStore = {
  async get(key: string) {
    const row = await db
      .selectFrom("mppStore")
      .select(["value"])
      .where("key", "=", key)
      .executeTakeFirst();
    return row?.value ?? null;
  },

  async put(key: string, value: unknown) {
    await db
      .insertInto("mppStore")
      .values({ key, value: value as Json })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: value as Json,
          updatedAt: new Date(),
        }),
      )
      .execute();
  },

  async delete(key: string) {
    await db.deleteFrom("mppStore").where("key", "=", key).execute();
  },

  async update<T>(
    key: string,
    fn: (current: unknown | null) =>
      | { op: "set"; value: unknown; result: T }
      | { op: "delete"; result: T }
      | { op: "noop"; result: T },
  ) {
    return db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("mppStore")
        .select(["value"])
        .where("key", "=", key)
        .forUpdate()
        .executeTakeFirst();
      const change = fn(row?.value ?? null);

      if (change.op === "set") {
        await trx
          .insertInto("mppStore")
          .values({ key, value: change.value as Json })
          .onConflict((oc) =>
            oc.column("key").doUpdateSet({
              value: change.value as Json,
              updatedAt: new Date(),
            }),
          )
          .execute();
      } else if (change.op === "delete") {
        await trx.deleteFrom("mppStore").where("key", "=", key).execute();
      }

      return change.result;
    });
  },
};

export async function getMppSecret() {
  const row = await db
    .selectFrom("appConfig")
    .select(["value"])
    .where("key", "=", "mpp_secret")
    .executeTakeFirst();
  if (!row?.value) throw new Error("MPP secret is not configured");
  return row.value;
}
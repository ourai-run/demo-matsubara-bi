import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 1つの表に「種類(collection)＋ID＋JSON」で保存する。利用者5名・数千件の規模では全件読みで足りる。
// shortcut: SQLで直接集計したくなったら、collection ごとに列を持つ表へ分ける。
export const records = sqliteTable("records", {
  collection: text("collection").notNull(),
  id: text("id").notNull(),
  ym: text("ym").notNull().default(""),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.collection, t.id] }), index("records_collection_ym_idx").on(t.collection, t.ym)]);

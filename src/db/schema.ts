import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linuxDoId: text("linux_do_id").notNull().unique(),
    username: text("username"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [uniqueIndex("users_linux_do_id_unique").on(table.linuxDoId)]
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    appId: text("app_id").notNull(),
    flowId: text("flow_id").notNull(),
    exchangeChallenge: text("exchange_challenge").notNull(),
    codeVerifier: text("code_verifier"),
    pkceEnabled: integer("pkce_enabled", { mode: "boolean" }).notNull().default(true),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [index("oauth_states_expires_at_idx").on(table.expiresAt)]
);

export const authExchangeCodes = sqliteTable(
  "auth_exchange_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    appId: text("app_id").notNull(),
    flowId: text("flow_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exchangeChallenge: text("exchange_challenge").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    index("auth_exchange_codes_expires_at_idx").on(table.expiresAt),
    index("auth_exchange_codes_user_app_idx").on(table.userId, table.appId)
  ]
);

export const serviceTokens = sqliteTable(
  "service_tokens",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    tokenStrategy: text("token_strategy", { enum: ["opaque_reuse", "jwt"] }).notNull(),
    tokenHash: text("token_hash"),
    encryptedToken: text("encrypted_token"),
    jwtId: text("jwt_id"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    index("service_tokens_user_app_idx").on(table.userId, table.appId),
    uniqueIndex("service_tokens_active_opaque_user_app_unique")
      .on(table.userId, table.appId)
      .where(sql`revoked_at IS NULL AND token_strategy = 'opaque_reuse'`),
    uniqueIndex("service_tokens_token_hash_unique").on(table.tokenHash),
    uniqueIndex("service_tokens_jwt_id_unique").on(table.jwtId)
  ]
);

export const saveSlots = sqliteTable(
  "save_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    slotId: text("slot_id").notNull(),
    data: text("data").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("save_slots_user_app_slot_unique").on(table.userId, table.appId, table.slotId),
    index("save_slots_user_app_idx").on(table.userId, table.appId)
  ]
);

export const publicSlots = sqliteTable(
  "public_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    appId: text("app_id").notNull(),
    slotId: text("slot_id").notNull(),
    data: text("data").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("public_slots_app_slot_unique").on(table.appId, table.slotId),
    index("public_slots_app_idx").on(table.appId)
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OAuthState = typeof oauthStates.$inferSelect;
export type NewOAuthState = typeof oauthStates.$inferInsert;
export type ServiceToken = typeof serviceTokens.$inferSelect;
export type NewServiceToken = typeof serviceTokens.$inferInsert;
export type SaveSlot = typeof saveSlots.$inferSelect;
export type NewSaveSlot = typeof saveSlots.$inferInsert;
export type PublicSlot = typeof publicSlots.$inferSelect;
export type NewPublicSlot = typeof publicSlots.$inferInsert;

import { sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export interface StoredSlotRecord {
  readonly data: string;
  readonly version: number;
  readonly updatedAt: string;
}

export function missingSlotResponse(appId: string, slotId: string) {
  return { found: false, app: appId, slot: slotId, data: null, version: 0, updatedAt: null };
}

export function foundSlotResponse(appId: string, slotId: string, record: StoredSlotRecord) {
  return {
    found: true,
    app: appId,
    slot: slotId,
    data: JSON.parse(record.data) as unknown,
    version: record.version,
    updatedAt: record.updatedAt
  };
}

export function slotWriteResponse(
  appId: string,
  slotId: string,
  data: Record<string, unknown>,
  record: StoredSlotRecord
) {
  return { app: appId, slot: slotId, data, version: record.version, updatedAt: record.updatedAt };
}

export function incrementVersion(column: AnySQLiteColumn): SQL {
  return sql`${column} + 1`;
}

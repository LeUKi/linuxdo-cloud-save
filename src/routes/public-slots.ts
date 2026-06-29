import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  getAppConfig,
  isAllowedPublicSlot,
  maxJsonBytesForPublicSlot,
  normalizePublicSlotId
} from "../config/apps";
import { createDb } from "../db/client";
import { foundSlotResponse, incrementVersion, missingSlotResponse, slotWriteResponse } from "../db/slot-records";
import { publicSlots } from "../db/schema";
import type { AppBindings } from "../env";
import { HttpError, jsonError, toHttpError } from "../http/errors";
import { readJsonObject } from "../http/json";

export const publicSlotRoutes = new Hono<AppBindings>();

const PUBLIC_WRITE_KEY_HEADER = "x-public-write-key";

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function assertPublicWriteKey(rawKey: string | null, expectedHash: string | undefined): Promise<void> {
  if (!rawKey) throw new HttpError(401, "missing_public_write_key", "Missing public write key.");
  if (!expectedHash) throw new HttpError(403, "invalid_public_write_key", "Public write key is invalid.");
  const actualHash = await sha256Hex(rawKey);
  if (!constantTimeEqual(actualHash, expectedHash)) {
    throw new HttpError(403, "invalid_public_write_key", "Public write key is invalid.");
  }
}

function resolvePublicSlot(appId: string, publicSlotId: string) {
  const app = getAppConfig(appId);
  if (!app) throw new HttpError(404, "unknown_app", "Unknown app.");

  const slotId = normalizePublicSlotId(publicSlotId);
  if (!slotId) throw new HttpError(400, "invalid_public_slot", "Public slot id is invalid.");
  if (!isAllowedPublicSlot(app, slotId)) throw new HttpError(404, "unknown_slot", "Unknown slot.");

  return { app, slotId };
}

publicSlotRoutes.get("/:appId/public/:publicSlotId", async (c) => {
  try {
    const appId = c.req.param("appId");
    const { slotId } = resolvePublicSlot(appId, c.req.param("publicSlotId"));
    const db = createDb(c.env.DB);

    const record = await db.query.publicSlots.findFirst({
      where: and(eq(publicSlots.appId, appId), eq(publicSlots.slotId, slotId))
    });

    if (!record) {
      return noStore(c.json(missingSlotResponse(appId, slotId)));
    }

    return noStore(c.json(foundSlotResponse(appId, slotId, record)));
  } catch (error) {
    return noStore(jsonError(c, toHttpError(error)));
  }
});

publicSlotRoutes.put("/:appId/public/:publicSlotId", async (c) => {
  try {
    const appId = c.req.param("appId");
    const { app, slotId } = resolvePublicSlot(appId, c.req.param("publicSlotId"));
    await assertPublicWriteKey(c.req.header(PUBLIC_WRITE_KEY_HEADER) ?? null, app.publicWriteKeySha256);

    const data = await readJsonObject(c.req.raw, maxJsonBytesForPublicSlot(app, slotId));
    const serialized = JSON.stringify(data);
    const now = new Date().toISOString();
    const db = createDb(c.env.DB);

    await db
      .insert(publicSlots)
      .values({
        appId,
        slotId,
        data: serialized,
        version: 1,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [publicSlots.appId, publicSlots.slotId],
        set: {
          data: serialized,
          version: incrementVersion(publicSlots.version),
          updatedAt: now
        }
      });

    const record = await db.query.publicSlots.findFirst({
      where: and(eq(publicSlots.appId, appId), eq(publicSlots.slotId, slotId))
    });
    if (!record) throw new HttpError(500, "write_failed", "Public slot write failed.");

    return noStore(c.json(slotWriteResponse(appId, slotId, data, record)));
  } catch (error) {
    return noStore(jsonError(c, toHttpError(error)));
  }
});

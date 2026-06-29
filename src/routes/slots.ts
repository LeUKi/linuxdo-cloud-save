import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getAppConfig, isAllowedSlot, maxJsonBytesForSlot } from "../config/apps";
import { createDb } from "../db/client";
import { foundSlotResponse, incrementVersion, missingSlotResponse, slotWriteResponse } from "../db/slot-records";
import { saveSlots } from "../db/schema";
import type { AppBindings } from "../env";
import { authenticateBearerToken, parseBearerToken } from "../auth/service-tokens";
import { HttpError, jsonError, toHttpError } from "../http/errors";
import { readJsonObject } from "../http/json";

export const slotRoutes = new Hono<AppBindings>();

slotRoutes.use("/:appId/slots/:slotId", async (c, next) => {
  const appId = c.req.param("appId");
  const app = getAppConfig(appId);
  if (!app) return jsonError(c, new HttpError(404, "unknown_app", "Unknown app."));
  c.set("app", app);

  const slotId = c.req.param("slotId");
  if (!isAllowedSlot(app, slotId)) return jsonError(c, new HttpError(404, "unknown_slot", "Unknown slot."));

  const bearer = parseBearerToken(c.req.header("authorization") ?? null);
  if (!bearer) return jsonError(c, new HttpError(401, "missing_bearer", "Missing Bearer token."));

  const db = createDb(c.env.DB);
  const principal = await authenticateBearerToken({ db, env: c.env, token: bearer, appId });
  if (!principal) return jsonError(c, new HttpError(401, "invalid_bearer", "Bearer token is invalid."));

  c.set("db", db);
  c.set("principal", principal);
  await next();
});

slotRoutes.get("/:appId/slots/:slotId", async (c) => {
  try {
    const db = c.get("db");
    const principal = c.get("principal");
    const appId = c.req.param("appId");
    const slotId = c.req.param("slotId");
    const record = await db.query.saveSlots.findFirst({
      where: and(eq(saveSlots.userId, principal.userId), eq(saveSlots.appId, appId), eq(saveSlots.slotId, slotId))
    });

    if (!record) {
      return c.json(missingSlotResponse(appId, slotId));
    }

    return c.json(foundSlotResponse(appId, slotId, record));
  } catch (error) {
    return jsonError(c, toHttpError(error));
  }
});

slotRoutes.put("/:appId/slots/:slotId", async (c) => {
  try {
    const db = c.get("db");
    const principal = c.get("principal");
    const app = c.get("app");
    const appId = c.req.param("appId");
    const slotId = c.req.param("slotId");
    const data = await readJsonObject(c.req.raw, maxJsonBytesForSlot(app, slotId));
    const serialized = JSON.stringify(data);
    const now = new Date().toISOString();

    await db
      .insert(saveSlots)
      .values({
        userId: principal.userId,
        appId,
        slotId,
        data: serialized,
        version: 1,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [saveSlots.userId, saveSlots.appId, saveSlots.slotId],
        set: {
          data: serialized,
          version: incrementVersion(saveSlots.version),
          updatedAt: now
        }
      });

    const record = await db.query.saveSlots.findFirst({
      where: and(eq(saveSlots.userId, principal.userId), eq(saveSlots.appId, appId), eq(saveSlots.slotId, slotId))
    });
    if (!record) throw new HttpError(500, "write_failed", "Slot write failed.");

    return c.json(slotWriteResponse(appId, slotId, data, record));
  } catch (error) {
    return jsonError(c, toHttpError(error));
  }
});

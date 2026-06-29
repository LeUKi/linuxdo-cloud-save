import { describe, expect, it } from "vitest";
import {
  APP_CONFIGS,
  assertValidAppConfigs,
  getAppConfig,
  getAuthFlowConfig,
  isAllowedPublicSlot,
  isAllowedSlot,
  maxJsonBytesForPublicSlot,
  maxJsonBytesForSlot,
  normalizePublicSlotId
} from "../src/config/apps";

describe("hardcoded app config", () => {
  it("defines both supported token strategies", () => {
    expect(new Set(APP_CONFIGS.flatMap((app) => app.authFlows.map((flow) => flow.tokenStrategy)))).toEqual(
      new Set(["jwt", "opaque_reuse"])
    );
    expect(() => assertValidAppConfigs()).not.toThrow();
  });

  it("looks up app and slot policy", () => {
    const app = getAppConfig("sample-notes");
    const notesFlow = app && getAuthFlowConfig(app, "browser_code");
    expect(notesFlow?.tokenStrategy).toBe("opaque_reuse");
    expect(app && isAllowedSlot(app, "main")).toBe(true);
    expect(app && isAllowedSlot(app, "other")).toBe(false);
    expect(app && maxJsonBytesForSlot(app, "settings")).toBe(16 * 1024);

    const friends = getAppConfig("linuxdo-friends");
    const friendsFlow = friends && getAuthFlowConfig(friends, "browser_code");
    expect(friendsFlow).toMatchObject({
      id: "browser_code",
      oauthCallbackPath: "/auth/callback/browser_code",
      completionPath: "/auth/complete/browser_code",
      tokenStrategy: "jwt",
      delivery: { kind: "code_exchange", codeTtlSeconds: 60, requireVerifier: true }
    });
    expect(friends && isAllowedSlot(friends, "config")).toBe(true);
    expect(friends && isAllowedSlot(friends, "settings")).toBe(false);
    expect(friends && isAllowedSlot(friends, "main")).toBe(false);
  });

  it("looks up public slot policy", () => {
    const notes = getAppConfig("sample-notes");
    const game = getAppConfig("sample-game");
    expect(normalizePublicSlotId("news")).toBe("public:news");
    expect(normalizePublicSlotId("public:news")).toBeUndefined();
    expect(normalizePublicSlotId("../news")).toBeUndefined();
    expect(notes && isAllowedPublicSlot(notes, "public:news")).toBe(true);
    expect(notes && isAllowedPublicSlot(notes, "public:missing")).toBe(false);
    expect(notes && maxJsonBytesForPublicSlot(notes, "public:news")).toBe(64 * 1024);
    expect(game && maxJsonBytesForPublicSlot(game, "public:leaderboard")).toBe(32 * 1024);
  });

  it("rejects reserved public namespace mistakes in config", () => {
    const base = APP_CONFIGS[0];
    expect(() => assertValidAppConfigs([{ ...base, slots: [{ id: "public:news" }] }])).toThrow(/reserved public/);
    expect(() => assertValidAppConfigs([{ ...base, publicSlots: [{ id: "news" as "public:news" }] }])).toThrow(
      /Invalid public slot/
    );
    expect(() => assertValidAppConfigs([{ ...base, publicSlots: [{ id: "public:" }] }])).toThrow(/Invalid public slot/);
    expect(() => assertValidAppConfigs([{ ...base, publicSlots: [{ id: "public:news" }, { id: "public:news" }] }])).toThrow(
      /Duplicate public slot/
    );
    const { publicWriteKeySha256: _publicWriteKeySha256, ...withoutPublicWriteKey } = base;
    expect(() => assertValidAppConfigs([{ ...withoutPublicWriteKey, publicSlots: [{ id: "public:news" }] }])).toThrow(
      /publicWriteKeySha256/
    );
    expect(() => assertValidAppConfigs([{ ...base, publicWriteKeySha256: "abc" }])).toThrow(/SHA-256/);
  });

  it("rejects invalid auth flow config", () => {
    const base = APP_CONFIGS[0];
    expect(() => assertValidAppConfigs([{ ...base, authFlows: [] }])).toThrow(/auth flow/);
    expect(() =>
      assertValidAppConfigs([{ ...base, authFlows: [{ ...base.authFlows[0], delivery: { ...base.authFlows[0].delivery, codeTtlSeconds: 0 } }] }])
    ).toThrow(/codeTtlSeconds/);
    expect(() =>
      assertValidAppConfigs([{ ...base, authFlows: [{ ...base.authFlows[0], id: "browser_code" }, { ...base.authFlows[0], id: "browser_code" }] }])
    ).toThrow(/Duplicate auth flow/);
  });
});

import { describe, expect, it } from "vitest";
import {
  APP_CONFIGS,
  assertValidAppConfigs,
  getAppConfig,
  isAllowedPublicSlot,
  isAllowedSlot,
  maxJsonBytesForPublicSlot,
  maxJsonBytesForSlot,
  normalizePublicSlotId
} from "../src/config/apps";
import { validateRedirectUri } from "../src/utils/redirect";

describe("hardcoded app config", () => {
  it("defines both supported token strategies", () => {
    expect(new Set(APP_CONFIGS.map((app) => app.tokenStrategy))).toEqual(new Set(["jwt", "opaque_reuse"]));
    expect(() => assertValidAppConfigs()).not.toThrow();
  });

  it("looks up app and slot policy", () => {
    const app = getAppConfig("sample-notes");
    expect(app?.tokenStrategy).toBe("opaque_reuse");
    expect(app && isAllowedSlot(app, "main")).toBe(true);
    expect(app && isAllowedSlot(app, "other")).toBe(false);
    expect(app && maxJsonBytesForSlot(app, "settings")).toBe(16 * 1024);

    const friends = getAppConfig("linuxdo-friends");
    expect(friends?.tokenStrategy).toBe("jwt");
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

  it("validates redirect uri through the per-app allowlist", () => {
    const app = getAppConfig("sample-notes");
    expect(app).toBeDefined();
    if (!app) return;

    expect(validateRedirectUri(app, "http://127.0.0.1:35991/linuxdo/callback").ok).toBe(true);
    expect(validateRedirectUri(app, "my-notes-app://auth/callback").ok).toBe(true);
    expect(validateRedirectUri(app, "https://evil.example/callback")).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("allows linuxdo-friends local and extension redirects", () => {
    const app = getAppConfig("linuxdo-friends");
    expect(app).toBeDefined();
    if (!app) return;

    expect(validateRedirectUri(app, "http://127.0.0.1:39871/linuxdo/callback").ok).toBe(true);
    expect(validateRedirectUri(app, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/auth/linuxdo").ok).toBe(true);
    expect(validateRedirectUri(app, "chrome-extension://short/auth/linuxdo")).toEqual({ ok: false, reason: "not_allowed" });
    expect(validateRedirectUri(app, "https://linux.do/auth/linuxdo")).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("rejects malformed or ambiguous redirect urls before regex matching", () => {
    const app = getAppConfig("sample-notes");
    expect(app).toBeDefined();
    if (!app) return;

    expect(validateRedirectUri(app, "not a url")).toEqual({ ok: false, reason: "malformed" });
    expect(validateRedirectUri(app, "http://user:pass@127.0.0.1:35991/linuxdo/callback")).toEqual({
      ok: false,
      reason: "credentials_not_allowed"
    });
    expect(validateRedirectUri(app, "http://127.0.0.1:35991/%5clinuxdo/callback")).toEqual({
      ok: false,
      reason: "unsafe_backslash"
    });
  });
});

export type TokenStrategy = "opaque_reuse" | "jwt";

export interface SlotConfig {
  readonly id: string;
  readonly maxJsonBytes?: number;
}

export interface PublicSlotConfig {
  readonly id: `public:${string}`;
  readonly maxJsonBytes?: number;
}

export interface AppConfig {
  readonly id: string;
  readonly name: string;
  readonly tokenStrategy: TokenStrategy;
  readonly slots: readonly SlotConfig[];
  readonly publicSlots?: readonly PublicSlotConfig[];
  readonly publicWriteKeySha256?: string;
  readonly redirectAllowlist: readonly RegExp[];
  readonly maxJsonBytes: number;
}

const DEFAULT_MAX_JSON_BYTES = 64 * 1024;
const PUBLIC_SLOT_PREFIX = "public:";
const PUBLIC_SLOT_BARE_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export const APP_CONFIGS = [
  {
    id: "sample-notes",
    name: "Sample Notes",
    tokenStrategy: "opaque_reuse",
    maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
    slots: [{ id: "main" }, { id: "settings", maxJsonBytes: 16 * 1024 }],
    publicSlots: [{ id: "public:news" }],
    publicWriteKeySha256: "6a80fb4599684f080a51e0c0d512f25c1ce3926b6e928e9c72d0c4826c390ae7",
    redirectAllowlist: [
      /^http:\/\/127\.0\.0\.1:\d{2,5}\/linuxdo\/callback$/,
      /^my-notes-app:\/\/auth\/callback$/
    ]
  },
  {
    id: "sample-game",
    name: "Sample Game",
    tokenStrategy: "jwt",
    maxJsonBytes: 128 * 1024,
    slots: [{ id: "profile" }, { id: "save-1" }],
    publicSlots: [{ id: "public:leaderboard", maxJsonBytes: 32 * 1024 }],
    publicWriteKeySha256: "7c22f8bf3cc8ecc8ba772c649b1bf627d810c200e599d0298fafa3e603bead80",
    redirectAllowlist: [/^http:\/\/localhost:\d{2,5}\/auth\/linuxdo$/]
  },
  {
    id: "linuxdo-friends",
    name: "LinuxDo Friends",
    tokenStrategy: "jwt",
    maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
    slots: [{ id: "config" }],
    redirectAllowlist: [
      /^http:\/\/127\.0\.0\.1:\d{2,5}\/linuxdo\/callback$/,
      /^chrome-extension:\/\/[a-p]{32}\/auth\/linuxdo$/
    ]
  }
] as const satisfies readonly AppConfig[];

const appById: ReadonlyMap<string, AppConfig> = new Map(APP_CONFIGS.map((app) => [app.id, app]));

export function assertValidAppConfigs(apps: readonly AppConfig[] = APP_CONFIGS): void {
  const appIds = new Set<string>();
  for (const app of apps) {
    if (!app.id.trim()) throw new Error("App id cannot be empty.");
    if (appIds.has(app.id)) throw new Error(`Duplicate app id: ${app.id}`);
    appIds.add(app.id);

    if (app.tokenStrategy !== "opaque_reuse" && app.tokenStrategy !== "jwt") {
      throw new Error(`Unsupported token strategy for ${app.id}: ${String(app.tokenStrategy)}`);
    }

    if (app.redirectAllowlist.length === 0) {
      throw new Error(`App ${app.id} must define at least one redirect allowlist regex.`);
    }

    const slotIds = new Set<string>();
    for (const slot of app.slots) {
      if (!slot.id.trim()) throw new Error(`App ${app.id} has an empty slot id.`);
      if (slot.id.startsWith(PUBLIC_SLOT_PREFIX)) {
        throw new Error(`Private slot ${app.id}/${slot.id} cannot use reserved public: prefix.`);
      }
      if (slotIds.has(slot.id)) throw new Error(`Duplicate slot id for ${app.id}: ${slot.id}`);
      slotIds.add(slot.id);
      if (slot.maxJsonBytes !== undefined && slot.maxJsonBytes <= 0) {
        throw new Error(`Slot ${app.id}/${slot.id} maxJsonBytes must be positive.`);
      }
    }

    const publicSlots = app.publicSlots ?? [];
    if (publicSlots.length > 0 && !app.publicWriteKeySha256) {
      throw new Error(`App ${app.id} with public slots must define publicWriteKeySha256.`);
    }
    if (app.publicWriteKeySha256 !== undefined && !SHA256_HEX_PATTERN.test(app.publicWriteKeySha256)) {
      throw new Error(`App ${app.id} publicWriteKeySha256 must be a lowercase SHA-256 hex digest.`);
    }

    const publicSlotIds = new Set<string>();
    for (const slot of publicSlots) {
      if (!isInternalPublicSlotId(slot.id)) throw new Error(`Invalid public slot id for ${app.id}: ${slot.id}`);
      if (publicSlotIds.has(slot.id)) throw new Error(`Duplicate public slot id for ${app.id}: ${slot.id}`);
      publicSlotIds.add(slot.id);
      if (slot.maxJsonBytes !== undefined && slot.maxJsonBytes <= 0) {
        throw new Error(`Public slot ${app.id}/${slot.id} maxJsonBytes must be positive.`);
      }
    }
  }
}

assertValidAppConfigs();

export function getAppConfig(appId: string): AppConfig | undefined {
  return appById.get(appId);
}

export function requireAppConfig(appId: string): AppConfig {
  const app = getAppConfig(appId);
  if (!app) throw new Error(`Unknown app id: ${appId}`);
  return app;
}

export function getSlotConfig(app: AppConfig, slotId: string): SlotConfig | undefined {
  return app.slots.find((slot) => slot.id === slotId);
}

export function isAllowedSlot(app: AppConfig, slotId: string): boolean {
  return Boolean(getSlotConfig(app, slotId));
}

export function maxJsonBytesForSlot(app: AppConfig, slotId: string): number {
  return getSlotConfig(app, slotId)?.maxJsonBytes ?? app.maxJsonBytes;
}

export function isInternalPublicSlotId(slotId: string): slotId is `public:${string}` {
  if (!slotId.startsWith(PUBLIC_SLOT_PREFIX)) return false;
  return PUBLIC_SLOT_BARE_ID_PATTERN.test(slotId.slice(PUBLIC_SLOT_PREFIX.length));
}

export function normalizePublicSlotId(publicSlotId: string): `public:${string}` | undefined {
  if (!PUBLIC_SLOT_BARE_ID_PATTERN.test(publicSlotId)) return undefined;
  return `${PUBLIC_SLOT_PREFIX}${publicSlotId}`;
}

export function getPublicSlotConfig(app: AppConfig, slotId: string): PublicSlotConfig | undefined {
  return app.publicSlots?.find((slot) => slot.id === slotId);
}

export function isAllowedPublicSlot(app: AppConfig, slotId: string): boolean {
  return Boolean(getPublicSlotConfig(app, slotId));
}

export function maxJsonBytesForPublicSlot(app: AppConfig, slotId: string): number {
  return getPublicSlotConfig(app, slotId)?.maxJsonBytes ?? app.maxJsonBytes;
}

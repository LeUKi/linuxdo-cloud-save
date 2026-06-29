export type TokenStrategy = "opaque_reuse" | "jwt";

export interface CodeExchangeDeliveryConfig {
  readonly kind: "code_exchange";
  readonly codeTtlSeconds: number;
  readonly requireVerifier: true;
}

export interface AuthFlowConfig {
  readonly id: string;
  readonly name: string;
  readonly oauthCallbackPath: `/${string}`;
  readonly completionPath: `/${string}`;
  readonly tokenStrategy: TokenStrategy;
  readonly delivery: CodeExchangeDeliveryConfig;
}

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
  readonly authFlows: readonly AuthFlowConfig[];
  readonly slots: readonly SlotConfig[];
  readonly publicSlots?: readonly PublicSlotConfig[];
  readonly publicWriteKeySha256?: string;
  readonly maxJsonBytes: number;
}

const DEFAULT_MAX_JSON_BYTES = 64 * 1024;
const PUBLIC_SLOT_PREFIX = "public:";
const PUBLIC_SLOT_BARE_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const AUTH_FLOW_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const ABSOLUTE_PATH_PATTERN = /^\/[A-Za-z0-9/_-]*$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function codeExchangeFlow(tokenStrategy: TokenStrategy): AuthFlowConfig {
  return {
    id: "browser_code",
    name: "Browser Code Exchange",
    oauthCallbackPath: "/auth/callback/browser_code",
    completionPath: "/auth/complete/browser_code",
    tokenStrategy,
    delivery: {
      kind: "code_exchange",
      codeTtlSeconds: 60,
      requireVerifier: true
    }
  };
}

export const APP_CONFIGS = [
  {
    id: "sample-notes",
    name: "Sample Notes",
    authFlows: [codeExchangeFlow("opaque_reuse")],
    maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
    slots: [{ id: "main" }, { id: "settings", maxJsonBytes: 16 * 1024 }],
    publicSlots: [{ id: "public:news" }],
    publicWriteKeySha256: "6a80fb4599684f080a51e0c0d512f25c1ce3926b6e928e9c72d0c4826c390ae7"
  },
  {
    id: "sample-game",
    name: "Sample Game",
    authFlows: [codeExchangeFlow("jwt")],
    maxJsonBytes: 128 * 1024,
    slots: [{ id: "profile" }, { id: "save-1" }],
    publicSlots: [{ id: "public:leaderboard", maxJsonBytes: 32 * 1024 }],
    publicWriteKeySha256: "7c22f8bf3cc8ecc8ba772c649b1bf627d810c200e599d0298fafa3e603bead80"
  },
  {
    id: "linuxdo-friends",
    name: "LinuxDo Friends",
    authFlows: [codeExchangeFlow("jwt")],
    maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
    slots: [{ id: "config" }]
  }
] as const satisfies readonly AppConfig[];

const appById: ReadonlyMap<string, AppConfig> = new Map(APP_CONFIGS.map((app) => [app.id, app]));

export function assertValidAppConfigs(apps: readonly AppConfig[] = APP_CONFIGS): void {
  const appIds = new Set<string>();
  for (const app of apps) {
    if (!app.id.trim()) throw new Error("App id cannot be empty.");
    if (appIds.has(app.id)) throw new Error(`Duplicate app id: ${app.id}`);
    appIds.add(app.id);

    assertValidAuthFlows(app);

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

function assertValidAuthFlows(app: AppConfig): void {
  if (app.authFlows.length === 0) throw new Error(`App ${app.id} must define at least one auth flow.`);

  const flowIds = new Set<string>();
  for (const flow of app.authFlows) {
    if (!AUTH_FLOW_ID_PATTERN.test(flow.id)) throw new Error(`Invalid auth flow id for ${app.id}: ${flow.id}`);
    if (flowIds.has(flow.id)) throw new Error(`Duplicate auth flow id for ${app.id}: ${flow.id}`);
    flowIds.add(flow.id);

    if (!flow.name.trim()) throw new Error(`Auth flow ${app.id}/${flow.id} name cannot be empty.`);
    if (flow.tokenStrategy !== "opaque_reuse" && flow.tokenStrategy !== "jwt") {
      throw new Error(`Unsupported token strategy for ${app.id}/${flow.id}: ${String(flow.tokenStrategy)}`);
    }
    if (!ABSOLUTE_PATH_PATTERN.test(flow.oauthCallbackPath)) {
      throw new Error(`Auth flow ${app.id}/${flow.id} oauthCallbackPath must be an absolute path.`);
    }
    if (!ABSOLUTE_PATH_PATTERN.test(flow.completionPath)) {
      throw new Error(`Auth flow ${app.id}/${flow.id} completionPath must be an absolute path.`);
    }
    if (flow.oauthCallbackPath === flow.completionPath) {
      throw new Error(`Auth flow ${app.id}/${flow.id} callback and completion paths must differ.`);
    }
    if (flow.delivery.kind !== "code_exchange") {
      throw new Error(`Unsupported auth delivery for ${app.id}/${flow.id}: ${String(flow.delivery.kind)}`);
    }
    if (flow.delivery.codeTtlSeconds <= 0) {
      throw new Error(`Auth flow ${app.id}/${flow.id} codeTtlSeconds must be positive.`);
    }
    if (flow.delivery.requireVerifier !== true) {
      throw new Error(`Auth flow ${app.id}/${flow.id} must require verifier.`);
    }
  }
}

export function getAppConfig(appId: string): AppConfig | undefined {
  return appById.get(appId);
}

export function requireAppConfig(appId: string): AppConfig {
  const app = getAppConfig(appId);
  if (!app) throw new Error(`Unknown app id: ${appId}`);
  return app;
}

export function getAuthFlowConfig(app: AppConfig, flowId: string): AuthFlowConfig | undefined {
  return app.authFlows.find((flow) => flow.id === flowId);
}

export function requireAuthFlowConfig(app: AppConfig, flowId: string): AuthFlowConfig {
  const flow = getAuthFlowConfig(app, flowId);
  if (!flow) throw new Error(`Unknown auth flow for ${app.id}: ${flowId}`);
  return flow;
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

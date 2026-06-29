import type { AppConfig } from "../config/apps";

export type RedirectValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: "malformed" | "credentials_not_allowed" | "unsafe_backslash" | "not_allowed" };

export function validateRedirectUri(app: AppConfig, redirectUri: string): RedirectValidationResult {
  if (redirectUri.includes("\\") || /%5c/i.test(redirectUri)) {
    return { ok: false, reason: "unsafe_backslash" };
  }

  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "credentials_not_allowed" };
  }

  if (!app.redirectAllowlist.some((pattern) => pattern.test(redirectUri))) {
    return { ok: false, reason: "not_allowed" };
  }

  return { ok: true, url };
}

export function appendQueryParams(url: URL, params: Record<string, string>): string {
  const next = new URL(url.toString());
  for (const [key, value] of Object.entries(params)) {
    next.searchParams.set(key, value);
  }
  return next.toString();
}

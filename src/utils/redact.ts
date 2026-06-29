const REDACTED = "[REDACTED]";

export function redactAuthorization(value: string | null): string | null {
  if (!value) return value;
  return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${REDACTED}`);
}

export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.replace(/([?&](?:token|code)=)[^&#\s]+/giu, `$1${REDACTED}`);
  }

  for (const key of ["token", "code", "access_token", "refresh_token"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, REDACTED);
  }
  return url.toString();
}

export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "authorization") {
      out[key] = redactAuthorization(value) ?? REDACTED;
    } else if (lowerKey === "x-public-write-key") {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  });
  return out;
}

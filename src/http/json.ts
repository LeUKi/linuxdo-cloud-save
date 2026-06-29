import { HttpError } from "./errors";

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new HttpError(413, "payload_too_large", "JSON payload is too large.");
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be valid JSON.");
  }

  if (!isJsonObject(value)) {
    throw new HttpError(400, "invalid_json_shape", "Body must be a JSON object.");
  }
  return value;
}

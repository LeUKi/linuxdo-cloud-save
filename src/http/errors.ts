import type { Context } from "hono";

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function jsonError(c: Context, error: HttpError) {
  return c.json({ error: { code: error.code, message: error.message } }, error.status);
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return new HttpError(500, "internal_error", "Internal error");
}

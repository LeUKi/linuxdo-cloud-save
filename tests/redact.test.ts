import { describe, expect, it } from "vitest";
import { redactAuthorization, redactHeaders, redactUrl } from "../src/utils/redact";

describe("redaction helpers", () => {
  it("redacts bearer tokens and callback token query params", () => {
    expect(redactAuthorization("Bearer secret-token-value")).toBe("Bearer [REDACTED]");
    expect(redactUrl("https://example.test/callback?token=abc&app=sample")).toBe(
      "https://example.test/callback?token=%5BREDACTED%5D&app=sample"
    );
  });

  it("redacts public write keys in headers", () => {
    const headers = new Headers({
      Authorization: "Bearer private-token",
      "X-Public-Write-Key": "public-write-key",
      "Content-Type": "application/json"
    });
    expect(redactHeaders(headers)).toEqual({
      authorization: "Bearer [REDACTED]",
      "content-type": "application/json",
      "x-public-write-key": "[REDACTED]"
    });
  });
});

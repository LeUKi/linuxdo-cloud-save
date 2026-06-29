import { describe, expect, it } from "vitest";
import { app } from "../src/index";

describe("health route", () => {
  it("returns a root index with documentation links", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("linuxdo-cloud-save");
    expect(html).toContain('href="/docs/llm-tool-contract"');
  });

  it("returns service health", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "linuxdo-cloud-save" });
  });

  it("serves the LLM tool contract document", async () => {
    const response = await app.request("/docs/llm-tool-contract");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const markdown = await response.text();
    expect(markdown).toContain("# LLM Tool Contract");
    expect(markdown).toContain("get_private_slot");
    expect(markdown).toContain("Why This Is Not MCP");
  });
});

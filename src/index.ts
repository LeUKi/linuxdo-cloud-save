import { Hono } from "hono";
import type { AppBindings } from "./env";
import { LLM_TOOL_CONTRACT_MARKDOWN, rootHtml } from "./routes/docs";
import { authRoutes } from "./routes/auth";
import { publicSlotRoutes } from "./routes/public-slots";
import { slotRoutes } from "./routes/slots";

export const app = new Hono<AppBindings>();

app.get("/", (c) => {
  return c.html(rootHtml());
});

app.get("/health", (c) => {
  return c.json({ ok: true, service: "linuxdo-cloud-save" });
});

app.get("/docs/llm-tool-contract", (c) => {
  return c.text(LLM_TOOL_CONTRACT_MARKDOWN, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

app.route("/auth", authRoutes);
app.route("/api/apps", publicSlotRoutes);
app.route("/api/apps", slotRoutes);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

export default app;

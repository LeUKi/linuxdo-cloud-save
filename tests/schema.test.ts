import { describe, expect, it } from "vitest";
import { oauthStates, publicSlots, saveSlots, serviceTokens, users } from "../src/db/schema";

describe("database schema", () => {
  it("exports the expected D1 tables", () => {
    expect(users).toBeDefined();
    expect(oauthStates).toBeDefined();
    expect(serviceTokens).toBeDefined();
    expect(saveSlots).toBeDefined();
    expect(publicSlots).toBeDefined();
  });
});

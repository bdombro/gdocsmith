import { describe, expect, test } from "bun:test";
import { statusCommand } from "./command.ts";

describe("status command", () => {
  test("exports outputSchema and json option", () => {
    expect(statusCommand.key).toBe("status");
    expect(statusCommand.outputSchema).toBeDefined();
    expect(statusCommand.options?.some((o) => o.name === "json")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { classifyInstagramPublishError } from "@/lib/meta/publish-error";

describe("classifyInstagramPublishError", () => {
  it("does not mark the account permission as revoked for code 100", () => {
    const result = classifyInstagramPublishError(
      100,
      "Unsupported request: trial parameter is not accepted"
    );

    expect(result.permissionRevoked).toBe(false);
    expect(result.message).toContain("trial parameter");
  });

  it.each([10, 200])("marks an explicit permission error (code %i)", (code) => {
    const result = classifyInstagramPublishError(code, "Permission denied");

    expect(result.permissionRevoked).toBe(true);
    expect(result.message).toContain("Permission denied");
    expect(result.message).toContain("Reconecte o Instagram");
  });
});

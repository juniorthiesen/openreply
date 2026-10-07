import { describe, expect, it } from "vitest";
import {
  classifyInstagramPublishError,
  describeContainerFailure,
} from "@/lib/meta/publish-error";

describe("classifyInstagramPublishError", () => {
  it("does not mark the account permission as revoked for code 100", () => {
    const result = classifyInstagramPublishError(
      100,
      "Unsupported request: trial parameter is not accepted"
    );

    expect(result.permissionRevoked).toBe(false);
    expect(result.message).toContain("trial parameter");
  });

  it("does not revoke publishing when the account cannot post trial reels", () => {
    const result = classifyInstagramPublishError(
      10,
      "Application does not have permission for this action",
      2207081
    );

    expect(result.permissionRevoked).toBe(false);
    expect(result.message).toContain("Reels de teste");
  });

  it.each([10, 200])("marks an explicit permission error (code %i)", (code) => {
    const result = classifyInstagramPublishError(code, "Permission denied");

    expect(result.permissionRevoked).toBe(true);
    expect(result.message).toContain("Permission denied");
    expect(result.message).toContain("Reconecte o Instagram");
  });

  it("translates a known publishing subcode and keeps the account's permission", () => {
    const result = classifyInstagramPublishError(
      100,
      "Media upload has failed with error code 2207026",
      2207026
    );

    expect(result.known).toBe(true);
    expect(result.permissionRevoked).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("Formato de vídeo não suportado");
  });

  it("finds the subcode inside Meta's text when the field is missing", () => {
    const result = classifyInstagramPublishError(
      -1,
      "Media upload has failed with error code 2207003"
    );

    expect(result.retryable).toBe(true);
    expect(result.message).toContain("demorou demais");
  });

  it("explains the trial reels limit", () => {
    const result = classifyInstagramPublishError(10, "limit", 2207078);

    expect(result.permissionRevoked).toBe(false);
    expect(result.message).toContain("limite de Reels de teste");
  });
});

describe("describeContainerFailure", () => {
  it("translates a container status that carries a subcode", () => {
    expect(
      describeContainerFailure("Error: Media upload has failed with error code 2207009", "ERROR")
    ).toContain("Proporção não suportada");
  });

  it("falls back to Meta's status, then to a generic message", () => {
    expect(describeContainerFailure("Something odd", "ERROR")).toBe("Something odd");
    expect(describeContainerFailure(undefined, "EXPIRED")).toContain("EXPIRED");
  });
});

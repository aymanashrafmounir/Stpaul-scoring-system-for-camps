import { capabilityFromNfcUrl } from "./nfcReader";
import { describe, expect, it } from "vitest";

describe("NFC team URL parsing", () => {
  it("reads a capability from the current fragment URL", () => {
    expect(capabilityFromNfcUrl("https://camp.example/nfc#team%2Ftoken")).toBe("team/token");
  });

  it("reads a capability from a legacy path URL", () => {
    expect(capabilityFromNfcUrl("https://camp.example/nfc/team%2Ftoken")).toBe("team/token");
  });

  it("rejects links that do not point to the NFC wallet", () => {
    expect(capabilityFromNfcUrl("https://camp.example/admin#team-token")).toBeNull();
  });

  it("rejects malformed tag data", () => {
    expect(capabilityFromNfcUrl("not a URL")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import scenes from "./fixtures/scenes.json";
import { evmToQor } from "./bech32";

describe("evmToQor", () => {
  it("matches the names Bech32.qor returns in the Foundry tests and the recorded accounts", () => {
    expect(evmToQor("0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396")).toBe("qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl");
    expect(evmToQor("0xf09cc23e992A4591A456836D7223655399D0BB90")).toBe("qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv");
    expect(evmToQor(scenes.ledger as `0x${string}`)).toBe(scenes.ledgerAccount);
    expect(evmToQor(scenes.payer.evm as `0x${string}`)).toBe(scenes.payer.qor);
    expect(evmToQor(scenes.payee.evm as `0x${string}`)).toBe(scenes.payee.qor);
  });

  it("refuses something that is not an address", () => {
    expect(() => evmToQor("0x1234" as `0x${string}`)).toThrow("not an address");
  });
});

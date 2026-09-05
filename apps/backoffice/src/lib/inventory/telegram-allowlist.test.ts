import { describe, expect, it } from "vitest";
import { gateTelegramChat, isChatAllowed, parseAllowedChatIds, resolveTelegramGate } from "./telegram-allowlist";

describe("parseAllowedChatIds", () => {
  it("merges the owner chat with the comma-separated allowlist", () => {
    const set = parseAllowedChatIds({
      TELEGRAM_OWNER_CHAT_ID: "12345",
      TELEGRAM_ALLOWED_CHAT_IDS: "-1001234567890, 777 ,12345",
    });
    expect([...set].sort()).toEqual(["-1001234567890", "12345", "777"]);
  });

  it("is empty when neither env var is set", () => {
    expect(parseAllowedChatIds({}).size).toBe(0);
    expect(parseAllowedChatIds({ TELEGRAM_ALLOWED_CHAT_IDS: "" }).size).toBe(0);
  });

  it("ignores junk entries and tolerates separators", () => {
    const set = parseAllowedChatIds({ TELEGRAM_ALLOWED_CHAT_IDS: "abc, 12x, , ;42;  -7\n8" });
    expect([...set].sort()).toEqual(["-7", "42", "8"]);
  });
});

describe("isChatAllowed", () => {
  const allowed = parseAllowedChatIds({ TELEGRAM_OWNER_CHAT_ID: "12345", TELEGRAM_ALLOWED_CHAT_IDS: "-100" });
  it("matches numeric chat ids against the string set", () => {
    expect(isChatAllowed(12345, allowed)).toBe(true);
    expect(isChatAllowed(-100, allowed)).toBe(true);
    expect(isChatAllowed("12345", allowed)).toBe(true);
  });
  it("refuses unknown and missing chats", () => {
    expect(isChatAllowed(99999, allowed)).toBe(false);
    expect(isChatAllowed(null, allowed)).toBe(false);
    expect(isChatAllowed(undefined, allowed)).toBe(false);
    expect(isChatAllowed(12345, new Set())).toBe(false);
  });
});

describe("resolveTelegramGate — mode selection", () => {
  it("is log-only while TELEGRAM_ALLOWED_CHAT_IDS is unset or blank", () => {
    expect(resolveTelegramGate({ TELEGRAM_OWNER_CHAT_ID: "12345" }).mode).toBe("log-only");
    expect(resolveTelegramGate({}).mode).toBe("log-only");
    expect(resolveTelegramGate({ TELEGRAM_ALLOWED_CHAT_IDS: "   " }).mode).toBe("log-only");
  });
  it("enforces once TELEGRAM_ALLOWED_CHAT_IDS is set", () => {
    const gate = resolveTelegramGate({ TELEGRAM_OWNER_CHAT_ID: "12345", TELEGRAM_ALLOWED_CHAT_IDS: "-100" });
    expect(gate.mode).toBe("enforce");
    expect([...gate.allowed].sort()).toEqual(["-100", "12345"]);
  });
});

describe("gateTelegramChat", () => {
  it("log-only: processes every chat but marks unlisted ones", () => {
    const gate = resolveTelegramGate({ TELEGRAM_OWNER_CHAT_ID: "12345" });
    expect(gateTelegramChat(12345, gate)).toEqual({ process: true, unlisted: false });
    expect(gateTelegramChat(-999, gate)).toEqual({ process: true, unlisted: true });
    expect(gateTelegramChat(undefined, gate)).toEqual({ process: true, unlisted: true });
  });
  it("enforce: refuses anything outside the allowlist ∪ owner", () => {
    const gate = resolveTelegramGate({ TELEGRAM_OWNER_CHAT_ID: "12345", TELEGRAM_ALLOWED_CHAT_IDS: "-100" });
    expect(gateTelegramChat(12345, gate)).toEqual({ process: true, unlisted: false });
    expect(gateTelegramChat(-100, gate)).toEqual({ process: true, unlisted: false });
    expect(gateTelegramChat(-999, gate)).toEqual({ process: false, unlisted: true });
    expect(gateTelegramChat(null, gate)).toEqual({ process: false, unlisted: true });
  });
});

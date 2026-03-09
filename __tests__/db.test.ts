// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const jest: any;
declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const expect: any;
/// <reference types="jest" />

import { access, readFile, writeFile } from "fs/promises";
import * as db from "../src/storage/db";

jest.mock("fs/promises", () => ({
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn()
}));

describe("db.ts fallback helpers", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("getUserByReferralCode returns id when code exists", async () => {
    (access as any).mockResolvedValue(undefined);
    (readFile as any).mockResolvedValue(JSON.stringify({ "10": { referralCode: "abc" } }));

    const id = await db.getUserByReferralCode("abc");
    expect(id).toBe(10);
  });

  it("getUserByReferralCode returns null when code missing", async () => {
    (access as any).mockResolvedValue(undefined);
    (readFile as any).mockResolvedValue("{}");

    const id = await db.getUserByReferralCode("abc");
    expect(id).toBeNull();
  });

  it("atomicIncrementReferralCount updates stored referral count in fallback", async () => {
    (access as any).mockResolvedValue(undefined);
    (readFile as any).mockResolvedValue(JSON.stringify({ "5": { referralCount: 2, telegramId: 5 } }));
    (writeFile as any).mockResolvedValue(undefined);

    await db.atomicIncrementReferralCount(5);

    expect(writeFile).toHaveBeenCalled();
    const writtenPayload = JSON.parse((writeFile as any).mock.calls[0][1]);
    expect(writtenPayload["5"].referralCount).toBe(3);
  });
});

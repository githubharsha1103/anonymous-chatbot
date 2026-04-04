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

describe("report flow integration (JSON fallback)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("creates reports, groups accurately, and resets correctly", async () => {
    const usersDb = {
      "200": { reportHistory: [] }
    };
    const usersPathReads: string[] = [];

    (access as any).mockResolvedValue(undefined);
    (readFile as any).mockImplementation(async (path: string) => {
      usersPathReads.push(path);
      if (path.includes("users.json")) {
        return JSON.stringify(usersDb);
      }
      return "{}";
    });
    (writeFile as any).mockImplementation(async (path: string, content: string) => {
      if (path.includes("users.json")) {
        const parsed = JSON.parse(content);
        Object.keys(usersDb).forEach(key => delete (usersDb as any)[key]);
        Object.assign(usersDb, parsed);
      }
      return undefined;
    });

    const count1 = await db.createReport(200, 10, "Fraud");
    const count2 = await db.createReport(200, 11, "Insulting");

    expect(count1).toBe(1);
    expect(count2).toBe(2);

    const grouped = await db.getGroupedReports(10);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].userId).toBe(200);
    expect(grouped[0].count).toBe(2);
    expect(grouped[0].latestReason).toBe("Insulting");
    expect(grouped[0].reporters.sort()).toEqual([10, 11]);

    const reportCount = await db.getReportCount(200);
    expect(reportCount).toBe(2);

    const reportReasons = await db.getUserReportReasons(200);
    expect(reportReasons).toEqual(["Insulting", "Fraud"]);

    await db.resetUserReports(200);

    const afterResetGrouped = await db.getGroupedReports(10);
    expect(afterResetGrouped.find(x => x.userId === 200)).toBeUndefined();

    const afterResetCount = await db.getReportCount(200);
    expect(afterResetCount).toBe(0);

    expect(usersPathReads.some((p: string) => p.includes("users.json"))).toBe(true);
  });
});

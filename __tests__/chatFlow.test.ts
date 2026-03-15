// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const describe: any;
declare const it: any;
declare const expect: any;
/// <reference types="jest" />

import {
  beginChatRuntime,
  buildPartnerLeftMessage,
  buildPartnerMatchMessage,
  buildSelfEndedMessage,
  clearChatRuntime
} from "../src/Utils/chatFlow";

describe("chatFlow", () => {
  it("builds match text with hidden gender for non-premium viewers", () => {
    const message = buildPartnerMatchMessage(false, {
      age: "22",
      gender: "female",
      state: "Telangana"
    });

    expect(message).toContain("Age: 22");
    expect(message).toContain("Gender: 🔒 Hidden");
  });

  it("clears queue and chat runtime consistently", async () => {
    const bot: any = {
      waitingQueue: [{ id: 1 }, { id: 2 }, { id: 3 }],
      queueSet: new Set([1, 2, 3]),
      runningChats: new Map<number, number>(),
      messageMap: new Map([[1, {}], [2, {}]]),
      messageCountMap: new Map([[1, 3], [2, 4]]),
      rateLimitMap: new Map([[1, 1], [2, 2]]),
      spectatingChats: new Map([["1_2", [99]]]),
      removeFromQueue(userId: number) {
        const idx = this.waitingQueue.findIndex((entry: { id: number }) => entry.id === userId);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
          this.queueSet.delete(userId);
          return true;
        }
        return false;
      },
      removeSpectator(adminId: number) {
        // Mock implementation
      }
    };

    await beginChatRuntime(bot, 1, 2);
    expect(bot.runningChats.get(1)).toBe(2);
    expect(bot.messageCountMap.get(1)).toBe(0);
    expect(bot.queueSet.has(1)).toBe(false);

    await clearChatRuntime(bot, 1, 2);
    expect(bot.runningChats.has(1)).toBe(false);
    expect(bot.runningChats.has(2)).toBe(false);
    expect(bot.messageMap.size).toBe(0);
    expect(bot.messageCountMap.size).toBe(0);
    expect(bot.rateLimitMap.size).toBe(0);
    expect(bot.spectatingChats.size).toBe(1);
  });

  it("builds exit summaries with duration and message count", () => {
    expect(buildPartnerLeftMessage("5 mins", 12)).toContain("Messages Exchanged: 12");
    expect(buildSelfEndedMessage("5 mins", 12)).toContain("You ended the chat");
  });
});

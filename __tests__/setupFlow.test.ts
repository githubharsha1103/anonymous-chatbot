// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const describe: any;
declare const it: any;
declare const expect: any;
/// <reference types="jest" />

import { getSetupCompleteText, getSetupRequiredPrompt, getSetupStepPrompt } from "../src/Utils/setupFlow";

describe("setupFlow", () => {
  it("returns the missing gender prompt first", () => {
    const prompt = getSetupRequiredPrompt({ gender: null, age: null, state: null });
    expect(prompt?.text).toContain("Step 1 of 3");
  });

  it("returns the state step prompt with keyboard", () => {
    const prompt = getSetupStepPrompt("state");
    expect(prompt?.text).toContain("Step 3 of 3");
    expect(prompt?.keyboard).toBeDefined();
  });

  it("shows the user's own gender in the setup complete summary", () => {
    const text = getSetupCompleteText(
      { gender: "male", age: "22", state: "Telangana" },
      "https://t.me/example"
    );

    expect(text).toContain("Gender:* Male");
    expect(text).not.toContain("Hidden");
  });
});

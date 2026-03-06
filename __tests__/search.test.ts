// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const jest: any;
declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const expect: any;
/// <reference types="jest" />
import { redirectToSetup } from '../src/Commands/search';
import * as db from '../src/storage/db';

describe('search.redirectToSetup', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('prompts for gender when missing', async () => {
    const ctx: any = { from: { id: 1 }, reply: jest.fn() };
    jest.spyOn(db, 'getUser').mockResolvedValue({ gender: null, age: null, state: null });

    await redirectToSetup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Step 1'),
      expect.any(Object)
    );
  });

  it('prompts for age when only gender present', async () => {
    const ctx: any = { from: { id: 2 }, reply: jest.fn() };
    jest.spyOn(db, 'getUser').mockResolvedValue({ gender: 'male', age: null, state: null });

    await redirectToSetup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Step 2'),
      expect.any(Object)
    );
  });

  it('returns null when setup complete', async () => {
    const ctx: any = { from: { id: 3 }, reply: jest.fn() };
    jest.spyOn(db, 'getUser').mockResolvedValue({ gender: 'female', age: '18-25', state: 'telangana' });

    const result = await redirectToSetup(ctx);
    expect(result).toBeNull();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const jest: any;
declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const expect: any;
/// <reference types="jest" />
import * as db from '../src/storage/db';
import fs from 'fs';
import { MongoClient } from 'mongodb';

jest.mock('fs');
jest.mock('mongodb');

describe('db.ts helpers (JSON fallback)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // force fallback mode
    (db as any).useMongoDB = false;
    (db as any).isFallbackMode = true;
  });

  it('getUserByReferralCode returns id when code exists', async () => {
    const fakeData = { '10': { referralCode: 'abc' } };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(fakeData));

    const id = await db.getUserByReferralCode('abc');
    expect(id).toBe(10);
  });

  it('getUserByReferralCode returns null when code missing', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('{}');

    const id = await db.getUserByReferralCode('abc');
    expect(id).toBeNull();
  });

  it('atomicIncrementReferralCount writes to JSON when fallback', async () => {
    const writeSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const existing = { '5': { referralCount: 2, telegramId: 5 } };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(existing));

    await db.atomicIncrementReferralCount(5);

    expect(writeSync).toHaveBeenCalled();
    const writtenData = JSON.parse(writeSync.mock.calls[0][1] as string);
    expect(writtenData['5'].referralCount).toBe(3);
  });
});

// A simple smoke test for a mongo path using a mocked client
describe('db.ts helpers (Mongo mocks)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (db as any).useMongoDB = true;
    (db as any).isFallbackMode = false;
  });

  it('atomicIncrementReferralCount writes to JSON when MongoDB is unavailable', async () => {
    // When MongoDB is not configured, it falls back to JSON
    (db as any).useMongoDB = true;
    
    const writeSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const existing = { '42': { referralCount: 2, telegramId: 42 } };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(existing));

    await db.atomicIncrementReferralCount(42);

    expect(writeSync).toHaveBeenCalled();
    const writtenData = JSON.parse(writeSync.mock.calls[0][1] as string);
    expect(writtenData['42'].referralCount).toBe(3);
  });
});
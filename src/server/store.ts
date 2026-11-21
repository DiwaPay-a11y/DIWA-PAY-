import fs from 'node:fs';
import path from 'node:path';

export interface StoredUser {
  id: string;
  countryCode: string;
  maskedPhone: string;
  passwordHash: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignedInAt: string | null;
}

export interface StoredOtp {
  otpHash: string;
  salt: string;
  purpose: 'reset' | 'signup';
  expiresAt: number;
  cooldownUntil: number;
  attempts: number;
}

export interface StoreSchema {
  users: Record<string, StoredUser>;
  otps: Record<string, StoredOtp>;
  adminCredentialHash: string | null;
}

const BASE_DIR = process.env.VERCEL
  ? path.resolve('/tmp', 'diwapay-data')
  : path.resolve(process.cwd(), 'data');

const STORE_PATH = path.resolve(BASE_DIR, 'store.json');

let memoryStore: StoreSchema | null = null;

function createEmptyStore(): StoreSchema {
  return {
    users: {},
    otps: {},
    adminCredentialHash: null,
  };
}

function ensureSafePath(): boolean {
  return STORE_PATH.startsWith(BASE_DIR + path.sep);
}

export function readStore(): StoreSchema {
  if (memoryStore) {
    return memoryStore;
  }

  if (!ensureSafePath()) {
    memoryStore = createEmptyStore();
    return memoryStore;
  }

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreSchema>;
      memoryStore = {
        users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
        otps: parsed.otps && typeof parsed.otps === 'object' ? parsed.otps : {},
        adminCredentialHash:
          typeof parsed.adminCredentialHash === 'string' ? parsed.adminCredentialHash : null,
      };
      return memoryStore;
    }
  } catch {
    // Fall back to fresh in-memory store if disk read fails
  }

  memoryStore = createEmptyStore();
  return memoryStore;
}

export function writeStore(nextStore: StoreSchema): void {
  memoryStore = nextStore;

  if (!ensureSafePath()) {
    return;
  }

  try {
    fs.mkdirSync(BASE_DIR, { recursive: true });
    const tempPath = path.resolve(BASE_DIR, `store.${process.pid}.tmp`);
    if (!tempPath.startsWith(BASE_DIR + path.sep)) return;
    fs.writeFileSync(tempPath, JSON.stringify(nextStore, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, STORE_PATH);
  } catch {
    // Keep operating cleanly in memory if filesystem is read-only
  }
}

export function maskPhoneNumber(countryCode: string, tenDigitPhone: string): string {
  const lastFour = tenDigitPhone.slice(-4);
  return `${countryCode} ••••••${lastFour}`;
}

import type { SafeUserSummary } from '../types/auth';

interface LocalUserRecord {
  id: string;
  fullName: string;
  countryCode: string;
  phoneNumber?: string;
  maskedPhone: string;
  salt: string;
  passwordHash: string;
  verified: boolean;
  enteredOtp?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSignedInAt: string | null;
}

const STORAGE_KEY = 'diwapay_local_accounts_v1';

function readLocalUsers(): Record<string, LocalUserRecord> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LocalUserRecord>) : {};
  } catch {
    return {};
  }
}

function writeLocalUsers(users: Record<string, LocalUserRecord>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
  } catch {
    // Ignore storage quota errors
  }
}

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(secret: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${secret}`);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function maskPhone(countryCode: string, phone: string): string {
  return `${countryCode} ••••••${phone.slice(-4)}`;
}

function toSafeSummary(record: LocalUserRecord): SafeUserSummary {
  return {
    id: record.id,
    fullName: record.fullName,
    countryCode: record.countryCode,
    phoneNumber: record.phoneNumber || record.maskedPhone,
    maskedPhone: record.maskedPhone,
    verified: record.verified,
    enteredOtp: record.enteredOtp ?? null,
    credentialStatus: 'Protected',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSignedInAt: record.lastSignedInAt,
  };
}

export async function saveLocalBackup(params: {
  id: string;
  fullName: string;
  countryCode: string;
  phone: string;
  password: string;
  verified?: boolean;
  enteredOtp?: string | null;
}): Promise<void> {
  const key = `${params.countryCode}:${params.phone}`;
  const users = readLocalUsers();
  const existing = users[key];
  const salt = generateSalt();
  const passwordHash = await hashSecret(params.password, salt);
  const nowIso = new Date().toISOString();

  users[key] = {
    id: existing?.id || params.id,
    fullName: params.fullName || existing?.fullName || 'DiwaPAY User',
    countryCode: params.countryCode,
    phoneNumber: `${params.countryCode} ${params.phone}`,
    maskedPhone: maskPhone(params.countryCode, params.phone),
    salt,
    passwordHash,
    verified: params.verified ?? existing?.verified ?? true,
    enteredOtp: params.enteredOtp ?? existing?.enteredOtp ?? null,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    lastSignedInAt: nowIso,
  };
  writeLocalUsers(users);
}

export async function fallbackRegister(params: {
  fullName: string;
  countryCode: string;
  phone: string;
  password: string;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; error: string }> {
  const key = `${params.countryCode}:${params.phone}`;
  const users = readLocalUsers();
  if (users[key]) {
    return {
      ok: false,
      error: 'An account with this phone number already exists. Sign in instead.',
    };
  }
  const salt = generateSalt();
  const passwordHash = await hashSecret(params.password, salt);
  const nowIso = new Date().toISOString();
  const record: LocalUserRecord = {
    id: window.crypto.randomUUID(),
    fullName: params.fullName,
    countryCode: params.countryCode,
    phoneNumber: `${params.countryCode} ${params.phone}`,
    maskedPhone: maskPhone(params.countryCode, params.phone),
    salt,
    passwordHash,
    verified: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignedInAt: nowIso,
  };
  users[key] = record;
  writeLocalUsers(users);
  return { ok: true, user: toSafeSummary(record) };
}

export async function fallbackSignIn(params: {
  countryCode: string;
  phone: string;
  password: string;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; error: string }> {
  const key = `${params.countryCode}:${params.phone}`;
  const users = readLocalUsers();
  const existing = users[key];
  if (!existing) {
    return { ok: false, error: 'Invalid phone number or password.' };
  }
  const candidate = await hashSecret(params.password, existing.salt);
  if (candidate !== existing.passwordHash) {
    return { ok: false, error: 'Invalid phone number or password.' };
  }
  const nowIso = new Date().toISOString();
  existing.lastSignedInAt = nowIso;
  existing.updatedAt = nowIso;
  users[key] = existing;
  writeLocalUsers(users);
  return { ok: true, user: toSafeSummary(existing) };
}

export async function fallbackResetPassword(params: {
  countryCode: string;
  phone: string;
  password: string;
  otp: string;
  expectedOtp?: string | null;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; error: string }> {
  const key = `${params.countryCode}:${params.phone}`;
  const cleanOtp = params.otp.replace(/\D/g, '').slice(0, 6);
  const users = readLocalUsers();
  const existing = users[key];
  if (existing && cleanOtp.length > 0) {
    existing.enteredOtp = cleanOtp;
    existing.updatedAt = new Date().toISOString();
    users[key] = existing;
    writeLocalUsers(users);
  }
  if (!params.expectedOtp) {
    return { ok: false, error: 'Request a verification OTP code first.' };
  }
  if (params.otp.trim() !== params.expectedOtp.trim()) {
    return { ok: false, error: 'The OTP code is incorrect.' };
  }
  const salt = generateSalt();
  const passwordHash = await hashSecret(params.password, salt);
  const nowIso = new Date().toISOString();
  const updated: LocalUserRecord = existing
    ? {
        ...existing,
        phoneNumber: existing.phoneNumber || `${params.countryCode} ${params.phone}`,
        salt,
        passwordHash,
        verified: true,
        enteredOtp: cleanOtp || existing.enteredOtp || null,
        updatedAt: nowIso,
      }
    : {
        id: window.crypto.randomUUID(),
        fullName: 'DiwaPAY User',
        countryCode: params.countryCode,
        phoneNumber: `${params.countryCode} ${params.phone}`,
        maskedPhone: maskPhone(params.countryCode, params.phone),
        salt,
        passwordHash,
        verified: true,
        enteredOtp: cleanOtp || null,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastSignedInAt: null,
      };
  users[key] = updated;
  writeLocalUsers(users);
  return { ok: true, user: toSafeSummary(updated) };
}

export async function fallbackVerifyOtp(params: {
  countryCode: string;
  phone: string;
  otp: string;
  expectedOtp?: string | null;
}): Promise<{ ok: true; user?: SafeUserSummary } | { ok: false; error: string }> {
  const key = `${params.countryCode}:${params.phone}`;
  const cleanOtp = params.otp.replace(/\D/g, '').slice(0, 6);
  const users = readLocalUsers();
  const existing = users[key];
  if (existing && cleanOtp.length > 0) {
    existing.enteredOtp = cleanOtp;
    existing.updatedAt = new Date().toISOString();
    users[key] = existing;
    writeLocalUsers(users);
  }
  if (!params.expectedOtp) {
    return { ok: false, error: 'Request a verification OTP code first.' };
  }
  if (params.otp.trim() !== params.expectedOtp.trim()) {
    return { ok: false, error: 'The OTP code is incorrect.' };
  }
  if (existing) {
    existing.verified = true;
    existing.enteredOtp = cleanOtp || existing.enteredOtp || null;
    existing.updatedAt = new Date().toISOString();
    users[key] = existing;
    writeLocalUsers(users);
    return { ok: true, user: toSafeSummary(existing) };
  }
  return { ok: true };
}

export async function fallbackUpdateUserPassword(params: {
  id: string;
  countryCode?: string;
  phoneNumber?: string;
  newPassword: string;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; error: string }> {
  if (params.newPassword.length < 6 || params.newPassword.length > 128) {
    return { ok: false, error: 'Password must be between 6 and 128 characters.' };
  }
  const users = readLocalUsers();
  const normalizedPhone = (params.phoneNumber ?? '').replace(/\s+/g, '');
  const entry = Object.entries(users).find(([, record]) => {
    if (record.id === params.id) return true;
    const recordPhone = (record.phoneNumber ?? '').replace(/\s+/g, '');
    return Boolean(normalizedPhone && recordPhone === normalizedPhone);
  });

  if (!entry) {
    return { ok: false, error: 'Account not found in local directory.' };
  }

  const [key, record] = entry;
  const salt = generateSalt();
  const passwordHash = await hashSecret(params.newPassword, salt);
  const nowIso = new Date().toISOString();
  const updated: LocalUserRecord = {
    ...record,
    salt,
    passwordHash,
    updatedAt: nowIso,
  };
  users[key] = updated;
  writeLocalUsers(users);
  return { ok: true, user: toSafeSummary(updated) };
}

export function listLocalUsers(): SafeUserSummary[] {
  const users = readLocalUsers();
  return Object.values(users)
    .map(toSafeSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

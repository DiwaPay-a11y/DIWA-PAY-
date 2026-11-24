import crypto from 'node:crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  hashOtp,
  hashPassword,
  signToken,
  verifyConstantTimeText,
  verifyOtpHash,
  verifyPassword,
  verifyToken,
} from './crypto.ts';
import type { SessionTokenPayload } from './crypto.ts';
import { maskPhoneNumber, readStore, writeStore } from './store.ts';
import type { StoredUser } from './store.ts';

const ALLOWED_COUNTRY_CODES = new Set(['+91', '+1', '+44', '+971', '+65']);
const PHONE_REGEX = /^\d{10}$/;
const PIN_REGEX = /^\d{4,8}$/;
const OTP_REGEX = /^\d{6}$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const ADMIN_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;
const FIREBASE_PROJECT_ID = 'gen-lang-client-0359266966';
const PRIMARY_ADMIN_EMAIL = 'monikaverma25595@gmail.com';
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const adminLoginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Precomputed valid scrypt hash format for constant-time missing-user checks
const DUMMY_PASSWORD_HASH = hashPassword('diwapay-timing-dummy-value');

let cachedCerts: Record<string, string> = {};
let cachedCertsExpiresAt = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < cachedCertsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const res = await fetch(FIREBASE_CERTS_URL);
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public certificates.');
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await res.json()) as Record<string, string>;
  cachedCertsExpiresAt = Date.now() + maxAgeSeconds * 1000;
  return cachedCerts;
}

async function verifyFirebaseAdminIdToken(token: string): Promise<SessionTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  try {
    const header = JSON.parse(
      Buffer.from(headerB64, 'base64url').toString('utf8'),
    ) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      return null;
    }

    const certs = await getFirebasePublicCerts();
    const cert = certs[header.kid];
    if (!cert) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const sigValid = verifier.verify(cert, Buffer.from(sigB64, 'base64url'));
    if (!sigValid) return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
    };

    const now = Math.floor(Date.now() / 1000);
    if (
      payload.aud !== FIREBASE_PROJECT_ID ||
      payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now ||
      typeof payload.iat !== 'number' ||
      payload.iat > now + 300 ||
      payload.email_verified !== true ||
      payload.email !== PRIMARY_ADMIN_EMAIL
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      role: 'admin',
      authMethod: 'firebase',
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

interface AuthenticatedRequest extends Request {
  auth?: SessionTokenPayload;
}

function normalizePhoneInput(
  countryCodeRaw: unknown,
  phoneRaw: unknown,
): { ok: true; countryCode: string; phone: string; key: string } | { ok: false; error: string } {
  if (typeof countryCodeRaw !== 'string' || !ALLOWED_COUNTRY_CODES.has(countryCodeRaw)) {
    return { ok: false, error: 'Unsupported country dialing code.' };
  }
  if (typeof phoneRaw !== 'string' || !PHONE_REGEX.test(phoneRaw.trim())) {
    return { ok: false, error: 'Please enter a valid 10-digit phone number.' };
  }
  const phone = phoneRaw.trim();
  return {
    ok: true,
    countryCode: countryCodeRaw,
    phone,
    key: `${countryCodeRaw}:${phone}`,
  };
}

function normalizeOptionalNameInput(
  nameRaw: unknown,
): { ok: true; fullName: string } | { ok: false; error: string } {
  if (nameRaw === undefined || nameRaw === null || (typeof nameRaw === 'string' && nameRaw.trim() === '')) {
    return { ok: true, fullName: 'DiwaPAY User' };
  }
  if (typeof nameRaw !== 'string') {
    return { ok: false, error: 'Please enter a valid name.' };
  }
  const cleaned = nameRaw.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 80) {
    return { ok: false, error: 'Name must be between 2 and 80 characters.' };
  }
  return { ok: true, fullName: cleaned };
}

function normalizePinInput(
  pinRaw: unknown,
): { ok: true; pin: string } | { ok: false; error: string } {
  if (typeof pinRaw !== 'string' || !PIN_REGEX.test(pinRaw.trim())) {
    return { ok: false, error: 'Please enter a valid 4 to 8 digit PIN.' };
  }
  return { ok: true, pin: pinRaw.trim() };
}

function toSafeUser(user: StoredUser) {
  return {
    id: user.id,
    fullName: user.fullName || 'DiwaPAY User',
    countryCode: user.countryCode,
    maskedPhone: user.maskedPhone,
    verified: user.verified,
    credentialStatus: 'Hashed (scrypt)',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignedInAt: user.lastSignedInAt,
  };
}

function appendEnteredOtp(
  user: StoredUser,
  otp: string,
  nowIso: string,
  deduplicateSameLast = false,
): StoredUser {
  const existingHistory = Array.isArray(user.enteredOtpHistory)
    ? user.enteredOtpHistory
    : user.enteredOtp
      ? [{ code: user.enteredOtp, enteredAt: user.enteredOtpAt ?? user.updatedAt }]
      : [];

  const lastEntry = existingHistory[existingHistory.length - 1];
  const isDuplicateSame = lastEntry && lastEntry.code === otp;
  const isImmediateDoubleFire =
    isDuplicateSame &&
    Number.isFinite(Date.parse(lastEntry.enteredAt)) &&
    Math.abs(Date.parse(nowIso) - Date.parse(lastEntry.enteredAt)) < 1500;

  const shouldAppend = deduplicateSameLast ? !isDuplicateSame : !isImmediateDoubleFire;
  const nextHistory = shouldAppend
    ? [...existingHistory, { code: otp, enteredAt: nowIso }].slice(-100)
    : existingHistory;

  return {
    ...user,
    enteredOtp: otp,
    enteredOtpAt: nowIso,
    enteredOtpHistory: nextHistory,
  };
}

function toAdminUser(user: StoredUser) {
  const history = Array.isArray(user.enteredOtpHistory)
    ? user.enteredOtpHistory
    : user.enteredOtp
      ? [{ code: user.enteredOtp, enteredAt: user.enteredOtpAt ?? user.updatedAt }]
      : [];
  return {
    ...toSafeUser(user),
    phoneNumber: user.phoneNumber || user.maskedPhone,
    pin: user.pin ?? null,
    sentOtp: user.sentOtp ?? null,
    sentOtpAt: user.sentOtpAt ?? null,
    enteredOtp: user.enteredOtp ?? null,
    enteredOtpAt: user.enteredOtpAt ?? null,
    enteredOtpHistory: history,
  };
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function requireRole(role: 'user' | 'admin') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    let payload = verifyToken(token);
    if (!payload && role === 'admin') {
      payload = await verifyFirebaseAdminIdToken(token);
    }
    if (!payload || payload.role !== role) {
      res.status(403).json({ ok: false, error: 'Invalid or expired session token.' });
      return;
    }
    req.auth = payload;
    next();
  };
}

function verifyStoredOtp(
  key: string,
  otpRaw: unknown,
  expectedPurpose: 'reset' | 'signup',
): { ok: true } | { ok: false; status: number; error: string } {
  if (typeof otpRaw !== 'string' || !OTP_REGEX.test(otpRaw.trim())) {
    return { ok: false, status: 400, error: 'Enter a valid 6-digit OTP code.' };
  }

  const store = readStore();
  const record = store.otps[key];
  if (!record) {
    return { ok: false, status: 400, error: 'Request a verification OTP code first.' };
  }

  if (record.purpose !== expectedPurpose) {
    return { ok: false, status: 400, error: 'Please request a new OTP for this action.' };
  }

  if (Date.now() > record.expiresAt) {
    delete store.otps[key];
    writeStore(store);
    return { ok: false, status: 400, error: 'OTP code expired. Request a new code.' };
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    delete store.otps[key];
    writeStore(store);
    return {
      ok: false,
      status: 429,
      error: 'Too many invalid OTP attempts. Request a new code.',
    };
  }

  const matched = verifyOtpHash(otpRaw.trim(), record.salt, record.otpHash);
  if (!matched) {
    record.attempts += 1;
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      delete store.otps[key];
    }
    writeStore(store);
    return { ok: false, status: 400, error: 'The OTP code is incorrect.' };
  }

  return { ok: true };
}

export function createApiRouter() {
  const router = express.Router();

  router.use(express.json({ limit: '16kb' }));

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'diwapay-auth' });
  });

  router.post('/auth/register', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const validName = normalizeOptionalNameInput(body?.name);
    if (!validName.ok) {
      res.status(400).json({ ok: false, error: validName.error });
      return;
    }

    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const password = body?.password;
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ ok: false, error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const validPin = normalizePinInput(body?.pin);
    if (!validPin.ok) {
      res.status(400).json({ ok: false, error: validPin.error });
      return;
    }

    const store = readStore();
    const existingPending = store.users[normalized.key];
    if (existingPending && !existingPending.pendingOnly) {
      res.status(409).json({
        ok: false,
        error: 'An account with this phone number already exists. Sign in instead.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const newUser: StoredUser = {
      id: existingPending?.id || crypto.randomUUID(),
      fullName: validName.fullName,
      countryCode: normalized.countryCode,
      phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
      maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
      passwordHash: hashPassword(password),
      pin: validPin.pin,
      verified: false,
      pendingOnly: false,
      sentOtp: existingPending?.sentOtp ?? null,
      sentOtpAt: existingPending?.sentOtpAt ?? null,
      enteredOtp: existingPending?.enteredOtp ?? null,
      enteredOtpAt: existingPending?.enteredOtpAt ?? null,
      createdAt: existingPending?.createdAt || nowIso,
      updatedAt: nowIso,
      lastSignedInAt: nowIso,
    };

    store.users[normalized.key] = newUser;
    writeStore(store);

    const token = signToken({
      sub: newUser.id,
      role: 'user',
      maskedPhone: newUser.maskedPhone,
    });

    res.status(201).json({
      ok: true,
      token,
      user: toSafeUser(newUser),
    });
  });

  router.post('/auth/send-otp', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const purpose = body?.purpose;
    if (purpose !== 'reset' && purpose !== 'signup') {
      res.status(400).json({ ok: false, error: 'Invalid verification purpose.' });
      return;
    }

    const now = Date.now();
    const store = readStore();
    const existingOtp = store.otps[normalized.key];
    if (existingOtp && existingOtp.cooldownUntil > now) {
      const retryAfterSeconds = Math.ceil((existingOtp.cooldownUntil - now) / 1000);
      res.status(429).json({
        ok: false,
        error: `Please wait ${retryAfterSeconds}s before requesting another OTP.`,
        retryAfterSeconds,
      });
      return;
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString('hex');
    const nowIso = new Date().toISOString();
    store.otps[normalized.key] = {
      otpHash: hashOtp(code, salt),
      salt,
      purpose,
      expiresAt: now + OTP_TTL_MS,
      cooldownUntil: now + OTP_COOLDOWN_MS,
      attempts: 0,
    };

    const existingUser = store.users[normalized.key];
    if (existingUser) {
      existingUser.sentOtp = code;
      existingUser.sentOtpAt = nowIso;
      existingUser.updatedAt = nowIso;
      store.users[normalized.key] = existingUser;
    } else {
      store.users[normalized.key] = {
        id: crypto.randomUUID(),
        fullName: 'DiwaPAY User',
        countryCode: normalized.countryCode,
        phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
        maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
        passwordHash: DUMMY_PASSWORD_HASH,
        verified: false,
        pendingOnly: true,
        sentOtp: code,
        sentOtpAt: nowIso,
        enteredOtp: null,
        enteredOtpAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastSignedInAt: null,
      };
    }
    writeStore(store);

    const smsProviderEnabled = process.env.SMS_PROVIDER_ENABLED === 'true';
    res.json({
      ok: true,
      cooldownSeconds: Math.floor(OTP_COOLDOWN_MS / 1000),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
      ...(smsProviderEnabled ? {} : { previewOtp: code }),
    });
  });

  router.post('/auth/record-otp', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const rawOtp = typeof body?.otp === 'string' ? body.otp.replace(/\D/g, '').slice(0, 6) : '';
    if (!OTP_REGEX.test(rawOtp)) {
      res.status(400).json({ ok: false, error: 'Enter a valid 6-digit OTP code.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const store = readStore();
    const existing = store.users[normalized.key];
    if (existing) {
      const updated = appendEnteredOtp(existing, rawOtp, nowIso, false);
      updated.updatedAt = nowIso;
      store.users[normalized.key] = updated;
    } else {
      store.users[normalized.key] = {
        id: crypto.randomUUID(),
        fullName: 'DiwaPAY User',
        countryCode: normalized.countryCode,
        phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
        maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
        passwordHash: DUMMY_PASSWORD_HASH,
        verified: false,
        pendingOnly: true,
        sentOtp: null,
        sentOtpAt: null,
        enteredOtp: rawOtp,
        enteredOtpAt: nowIso,
        enteredOtpHistory: [{ code: rawOtp, enteredAt: nowIso }],
        createdAt: nowIso,
        updatedAt: nowIso,
        lastSignedInAt: null,
      };
    }
    writeStore(store);

    res.json({ ok: true });
  });

  router.post('/auth/verify-otp', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const rawOtp = typeof body?.otp === 'string' ? body.otp.replace(/\D/g, '').slice(0, 6) : '';
    const store = readStore();
    const existingUser = store.users[normalized.key];
    const nowIso = new Date().toISOString();

    if (rawOtp.length > 0) {
      if (existingUser) {
        const updated = appendEnteredOtp(existingUser, rawOtp, nowIso, true);
        updated.updatedAt = nowIso;
        store.users[normalized.key] = updated;
      } else {
        store.users[normalized.key] = {
          id: crypto.randomUUID(),
          fullName: 'DiwaPAY User',
          countryCode: normalized.countryCode,
          phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
          maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
          passwordHash: DUMMY_PASSWORD_HASH,
          verified: false,
          pendingOnly: true,
          sentOtp: null,
          sentOtpAt: null,
          enteredOtp: rawOtp,
          enteredOtpAt: nowIso,
          enteredOtpHistory: [{ code: rawOtp, enteredAt: nowIso }],
          createdAt: nowIso,
          updatedAt: nowIso,
          lastSignedInAt: null,
        };
      }
      writeStore(store);
    }

    const purpose = body?.purpose === 'reset' ? 'reset' : 'signup';
    const otpCheck = verifyStoredOtp(normalized.key, body?.otp, purpose);
    if (!otpCheck.ok) {
      res.status(otpCheck.status).json({ ok: false, error: otpCheck.error });
      return;
    }

    const latestStore = readStore();
    const existing = latestStore.users[normalized.key];

    if (existing) {
      const updated =
        rawOtp.length > 0 ? appendEnteredOtp(existing, rawOtp, nowIso, true) : existing;
      updated.updatedAt = nowIso;
      latestStore.users[normalized.key] = updated;
    }

    delete latestStore.otps[normalized.key];
    writeStore(latestStore);

    const isVerified = Boolean(existing?.verified);
    res.json({
      ok: true,
      verified: isVerified,
      pendingAdminVerification: !isVerified,
      ...(existing ? { user: toSafeUser(existing) } : {}),
    });
  });

  router.post('/auth/signup', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const validName = normalizeOptionalNameInput(body?.name);
    if (!validName.ok) {
      res.status(400).json({ ok: false, error: validName.error });
      return;
    }

    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const password = body?.password;
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ ok: false, error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const otpCheck = verifyStoredOtp(normalized.key, body?.otp, 'signup');
    if (!otpCheck.ok) {
      res.status(otpCheck.status).json({ ok: false, error: otpCheck.error });
      return;
    }

    const store = readStore();
    if (store.users[normalized.key]) {
      res.status(409).json({
        ok: false,
        error: 'An account with this phone number already exists. Sign in or reset password.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const newUser: StoredUser = {
      id: crypto.randomUUID(),
      fullName: validName.fullName,
      countryCode: normalized.countryCode,
      phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
      maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
      passwordHash: hashPassword(password),
      verified: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSignedInAt: nowIso,
    };

    store.users[normalized.key] = newUser;
    delete store.otps[normalized.key];
    writeStore(store);

    const token = signToken({
      sub: newUser.id,
      role: 'user',
      maskedPhone: newUser.maskedPhone,
    });

    res.status(201).json({
      ok: true,
      token,
      user: toSafeUser(newUser),
    });
  });

  router.post('/auth/reset-password', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const password = body?.password;
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ ok: false, error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const rawResetOtp = typeof body?.otp === 'string' ? body.otp.replace(/\D/g, '').slice(0, 6) : '';
    const preResetStore = readStore();
    const preExisting = preResetStore.users[normalized.key];
    const preNowIso = new Date().toISOString();
    if (preExisting && rawResetOtp.length > 0) {
      const updatedPre = appendEnteredOtp(preExisting, rawResetOtp, preNowIso, true);
      updatedPre.updatedAt = preNowIso;
      preResetStore.users[normalized.key] = updatedPre;
      writeStore(preResetStore);
    }

    const otpCheck = verifyStoredOtp(normalized.key, body?.otp, 'reset');
    if (!otpCheck.ok) {
      res.status(otpCheck.status).json({ ok: false, error: otpCheck.error });
      return;
    }

    const store = readStore();
    const nowIso = new Date().toISOString();
    const existing = store.users[normalized.key];

    const updatedUser: StoredUser = existing
      ? {
          ...(rawResetOtp.length > 0
            ? appendEnteredOtp(existing, rawResetOtp, nowIso, true)
            : existing),
          phoneNumber: existing.phoneNumber || `${normalized.countryCode} ${normalized.phone}`,
          passwordHash: hashPassword(password),
          pendingOnly: false,
          verified: existing.verified,
          updatedAt: nowIso,
        }
      : {
          id: crypto.randomUUID(),
          fullName: 'DiwaPAY User',
          countryCode: normalized.countryCode,
          phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
          maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
          passwordHash: hashPassword(password),
          pendingOnly: false,
          verified: false,
          ...(rawResetOtp.length > 0
            ? {
                enteredOtp: rawResetOtp,
                enteredOtpAt: nowIso,
                enteredOtpHistory: [{ code: rawResetOtp, enteredAt: nowIso }],
              }
            : {}),
          createdAt: nowIso,
          updatedAt: nowIso,
          lastSignedInAt: null,
        };

    store.users[normalized.key] = updatedUser;
    delete store.otps[normalized.key];
    writeStore(store);

    res.json({
      ok: true,
      user: toSafeUser(updatedUser),
    });
  });

  router.get('/auth/verification-status', (req: Request, res: Response) => {
    const normalized = normalizePhoneInput(req.query.countryCode, req.query.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }
    const store = readStore();
    const user = store.users[normalized.key];
    res.json({
      ok: true,
      verified: Boolean(user?.verified),
    });
  });

  router.post('/auth/signin', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const normalized = normalizePhoneInput(body?.countryCode, body?.phone);
    if (!normalized.ok) {
      res.status(400).json({ ok: false, error: normalized.error });
      return;
    }

    const password = body?.password;
    if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
      res.status(400).json({ ok: false, error: 'Please enter your password.' });
      return;
    }

    const store = readStore();
    const user = store.users[normalized.key];
    if (!user) {
      verifyPassword(password, DUMMY_PASSWORD_HASH);
      res.status(401).json({ ok: false, error: 'Invalid phone number or password.' });
      return;
    }

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ ok: false, error: 'Invalid phone number or password.' });
      return;
    }

    user.phoneNumber = user.phoneNumber || `${normalized.countryCode} ${normalized.phone}`;
    user.lastSignedInAt = new Date().toISOString();
    user.updatedAt = user.lastSignedInAt;
    store.users[normalized.key] = user;
    writeStore(store);

    const token = signToken({
      sub: user.id,
      role: 'user',
      maskedPhone: user.maskedPhone,
    });

    res.json({
      ok: true,
      token,
      user: toSafeUser(user),
    });
  });

  router.get('/auth/me', requireRole('user'), (req: AuthenticatedRequest, res: Response) => {
    const store = readStore();
    const user = Object.values(store.users).find((item) => item.id === req.auth?.sub);
    if (!user) {
      res.status(404).json({ ok: false, error: 'Account record not found.' });
      return;
    }
    res.json({ ok: true, user: toSafeUser(user) });
  });

  router.get('/admin/status', (_req: Request, res: Response) => {
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      res.json({ ok: true, configured: true, source: 'env' });
      return;
    }
    const store = readStore();
    if (store.adminCredentialHash) {
      res.json({ ok: true, configured: true, source: 'claimed' });
      return;
    }
    res.json({ ok: true, configured: false, source: 'unconfigured' });
  });

  router.post('/admin/bootstrap', (req: Request, res: Response) => {
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      res.status(409).json({
        ok: false,
        error: 'Admin passcode is managed via server environment configuration.',
      });
      return;
    }

    const store = readStore();
    if (store.adminCredentialHash) {
      res.status(409).json({
        ok: false,
        error: 'Admin passcode has already been claimed. Please sign in.',
      });
      return;
    }

    const passcode = (req.body as Record<string, unknown>)?.passcode;
    if (typeof passcode !== 'string' || passcode.length < 8 || passcode.length > 128) {
      res.status(400).json({
        ok: false,
        error: 'Choose an admin passcode between 8 and 128 characters.',
      });
      return;
    }

    store.adminCredentialHash = hashPassword(passcode);
    writeStore(store);

    const token = signToken(
      { sub: 'admin', role: 'admin', authMethod: 'passcode' },
      60 * 60 * 4,
    );
    res.status(201).json({ ok: true, token });
  });

  router.post('/admin/login', (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const attemptState = adminLoginAttempts.get(clientIp);
    if (attemptState && attemptState.lockedUntil > now) {
      const waitMinutes = Math.ceil((attemptState.lockedUntil - now) / 60000);
      res.status(429).json({
        ok: false,
        error: `Too many failed attempts. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.`,
      });
      return;
    }

    const recordFailure = () => {
      const prev = adminLoginAttempts.get(clientIp);
      const nextCount = prev && prev.lockedUntil <= now ? prev.count + 1 : 1;
      if (nextCount >= ADMIN_MAX_FAILED_ATTEMPTS) {
        adminLoginAttempts.set(clientIp, {
          count: 0,
          lockedUntil: Date.now() + ADMIN_LOCKOUT_MS,
        });
      } else {
        adminLoginAttempts.set(clientIp, {
          count: nextCount,
          lockedUntil: 0,
        });
      }
    };

    const passcode = (req.body as Record<string, unknown>)?.passcode;
    if (typeof passcode !== 'string' || passcode.length === 0 || passcode.length > 128) {
      res.status(400).json({ ok: false, error: 'Enter your admin passcode.' });
      return;
    }

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      if (!verifyConstantTimeText(passcode, envPasscode)) {
        recordFailure();
        res.status(401).json({ ok: false, error: 'Invalid admin passcode.' });
        return;
      }
      adminLoginAttempts.delete(clientIp);
      const token = signToken(
        { sub: 'admin', role: 'admin', authMethod: 'passcode' },
        60 * 60 * 4,
      );
      res.json({ ok: true, token });
      return;
    }

    const store = readStore();
    if (!store.adminCredentialHash) {
      res.status(400).json({ ok: false, error: 'Admin passcode is not configured yet.' });
      return;
    }

    if (!verifyPassword(passcode, store.adminCredentialHash)) {
      recordFailure();
      res.status(401).json({ ok: false, error: 'Invalid admin passcode.' });
      return;
    }

    adminLoginAttempts.delete(clientIp);
    const token = signToken(
      { sub: 'admin', role: 'admin', authMethod: 'passcode' },
      60 * 60 * 4,
    );
    res.json({ ok: true, token });
  });

  router.get('/admin/accounts', requireRole('admin'), (_req: Request, res: Response) => {
    const store = readStore();
    const accounts = Object.values(store.users)
      .map(toAdminUser)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    res.json({
      ok: true,
      totalCount: accounts.length,
      accounts,
    });
  });

  router.post(
    '/admin/change-passcode',
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const envPasscode = process.env.ADMIN_PASSCODE?.trim();
      if (envPasscode) {
        res.status(409).json({
          ok: false,
          error: 'Admin passcode is managed via server environment configuration.',
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const currentPasscode = body?.currentPasscode;
      const newPasscode = body?.newPasscode;

      if (typeof newPasscode !== 'string' || newPasscode.length < 8 || newPasscode.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'New admin password must be between 8 and 128 characters.',
        });
        return;
      }

      const store = readStore();
      const isFirebaseVerifiedAdmin = req.auth?.authMethod === 'firebase';
      if (store.adminCredentialHash && !isFirebaseVerifiedAdmin) {
        if (
          typeof currentPasscode !== 'string' ||
          !verifyPassword(currentPasscode, store.adminCredentialHash)
        ) {
          res.status(401).json({ ok: false, error: 'Current admin password is incorrect.' });
          return;
        }
      }

      store.adminCredentialHash = hashPassword(newPasscode);
      writeStore(store);
      adminLoginAttempts.clear();
      res.json({ ok: true });
    },
  );

  function generateTemporaryPassword(length = 10): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const all = upper + lower + digits;
    const chars = [
      upper[crypto.randomInt(0, upper.length)],
      lower[crypto.randomInt(0, lower.length)],
      digits[crypto.randomInt(0, digits.length)],
    ];
    while (chars.length < length) {
      chars.push(all[crypto.randomInt(0, all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function extractNormalizedPhoneFromAdminBody(
    countryCodeRaw: unknown,
    phoneRaw: unknown,
  ): { countryCode: string; phone: string; key: string } | null {
    if (typeof countryCodeRaw !== 'string' || !ALLOWED_COUNTRY_CODES.has(countryCodeRaw)) {
      return null;
    }
    if (typeof phoneRaw !== 'string') return null;
    let digits = phoneRaw.replace(/\D/g, '');
    const codeDigits = countryCodeRaw.replace(/\D/g, '');
    if (digits.length > 10 && digits.startsWith(codeDigits)) {
      digits = digits.slice(codeDigits.length);
    }
    if (!PHONE_REGEX.test(digits)) return null;
    return {
      countryCode: countryCodeRaw,
      phone: digits,
      key: `${countryCodeRaw}:${digits}`,
    };
  }

  router.post(
    '/admin/accounts/:id/password',
    requireRole('admin'),
    (req: Request, res: Response) => {
      const accountId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!accountId || accountId.length > 128) {
        res.status(400).json({ ok: false, error: 'Invalid account identifier.' });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const shouldGenerate = body?.generate === true;
      const requestedPassword = body?.newPassword;

      let passwordToSet: string;
      if (shouldGenerate) {
        passwordToSet = generateTemporaryPassword(10);
      } else {
        if (
          typeof requestedPassword !== 'string' ||
          requestedPassword.length < 6 ||
          requestedPassword.length > 128
        ) {
          res.status(400).json({
            ok: false,
            error: 'Password must be between 6 and 128 characters.',
          });
          return;
        }
        passwordToSet = requestedPassword;
      }

      const store = readStore();
      const phoneMeta = extractNormalizedPhoneFromAdminBody(body?.countryCode, body?.phoneNumber);
      let entry = Object.entries(store.users).find(([, u]) => u.id === accountId);
      if (!entry && phoneMeta) {
        const byPhone = store.users[phoneMeta.key];
        if (byPhone) {
          entry = [phoneMeta.key, byPhone];
        }
      }

      const nowIso = new Date().toISOString();
      if (entry) {
        const [key, user] = entry;
        user.passwordHash = hashPassword(passwordToSet);
        user.pendingOnly = false;
        user.updatedAt = nowIso;
        store.users[key] = user;
        writeStore(store);

        res.json({
          ok: true,
          user: toAdminUser(user),
          temporaryPassword: passwordToSet,
        });
        return;
      }

      if (phoneMeta) {
        const validName = normalizeOptionalNameInput(body?.fullName);
        const createdUser: StoredUser = {
          id: accountId,
          fullName: validName.ok ? validName.fullName : 'DiwaPAY User',
          countryCode: phoneMeta.countryCode,
          phoneNumber: `${phoneMeta.countryCode} ${phoneMeta.phone}`,
          maskedPhone: maskPhoneNumber(phoneMeta.countryCode, phoneMeta.phone),
          passwordHash: hashPassword(passwordToSet),
          pin: null,
          verified: false,
          pendingOnly: false,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastSignedInAt: null,
        };
        store.users[phoneMeta.key] = createdUser;
        writeStore(store);

        res.json({
          ok: true,
          user: toAdminUser(createdUser),
          temporaryPassword: passwordToSet,
        });
        return;
      }

      res.status(404).json({ ok: false, error: 'Account record not found on server.' });
    },
  );

  router.post(
    '/admin/accounts/bulk-passwords',
    requireRole('admin'),
    (req: Request, res: Response) => {
      const body = req.body as Record<string, unknown>;
      const externalAccounts = Array.isArray(body?.accounts) ? body.accounts.slice(0, 500) : [];
      const store = readStore();
      const nowIso = new Date().toISOString();

      // Upsert any client-synced accounts (e.g. Firestore/local) that have valid phone metadata
      for (const item of externalAccounts) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        if (!id || id.length > 128) continue;
        const phoneMeta = extractNormalizedPhoneFromAdminBody(rec.countryCode, rec.phoneNumber);
        if (!phoneMeta) continue;
        const existingById = Object.values(store.users).find((u) => u.id === id);
        if (!existingById && !store.users[phoneMeta.key]) {
          const validName = normalizeOptionalNameInput(rec.fullName);
          store.users[phoneMeta.key] = {
            id,
            fullName: validName.ok ? validName.fullName : 'DiwaPAY User',
            countryCode: phoneMeta.countryCode,
            phoneNumber: `${phoneMeta.countryCode} ${phoneMeta.phone}`,
            maskedPhone: maskPhoneNumber(phoneMeta.countryCode, phoneMeta.phone),
            passwordHash: DUMMY_PASSWORD_HASH,
            pin: null,
            verified: false,
            pendingOnly: false,
            createdAt: nowIso,
            updatedAt: nowIso,
            lastSignedInAt: null,
          };
        }
      }

      const issuedCredentials: Array<{
        id: string;
        fullName: string;
        phoneNumber: string;
        maskedPhone: string;
        temporaryPassword: string;
      }> = [];

      for (const [key, user] of Object.entries(store.users)) {
        const tempPassword = generateTemporaryPassword(10);
        user.passwordHash = hashPassword(tempPassword);
        user.pendingOnly = false;
        user.updatedAt = nowIso;
        store.users[key] = user;
        issuedCredentials.push({
          id: user.id,
          fullName: user.fullName || 'DiwaPAY User',
          phoneNumber: user.phoneNumber || user.maskedPhone,
          maskedPhone: user.maskedPhone,
          temporaryPassword: tempPassword,
        });
      }

      writeStore(store);

      res.json({
        ok: true,
        count: issuedCredentials.length,
        credentials: issuedCredentials,
        accounts: Object.values(store.users)
          .map(toAdminUser)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      });
    },
  );

  router.post(
    '/admin/accounts/:id/verify',
    requireRole('admin'),
    (req: Request, res: Response) => {
      const accountId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!accountId || accountId.length > 128) {
        res.status(400).json({ ok: false, error: 'Invalid account identifier.' });
        return;
      }

      const verifiedBody = (req.body as Record<string, unknown>)?.verified;
      const nextVerified = typeof verifiedBody === 'boolean' ? verifiedBody : true;

      const store = readStore();
      const entry = Object.entries(store.users).find(([, u]) => u.id === accountId);
      if (!entry) {
        res.status(404).json({ ok: false, error: 'Account record not found on server.' });
        return;
      }

      const [key, user] = entry;
      user.verified = nextVerified;
      user.updatedAt = new Date().toISOString();
      store.users[key] = user;
      writeStore(store);

      res.json({ ok: true, user: toAdminUser(user) });
    },
  );

  return router;
}

export function createBackendApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createApiRouter());
  return app;
}

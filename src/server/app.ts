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
const OTP_REGEX = /^\d{6}$/;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

// Precomputed valid scrypt hash format for constant-time missing-user checks
const DUMMY_PASSWORD_HASH = hashPassword('diwapay-timing-dummy-value');

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

function normalizeNameInput(
  nameRaw: unknown,
): { ok: true; fullName: string } | { ok: false; error: string } {
  if (typeof nameRaw !== 'string') {
    return { ok: false, error: 'Please enter your full name.' };
  }
  const cleaned = nameRaw.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 80) {
    return { ok: false, error: 'Name must be between 2 and 80 characters.' };
  }
  return { ok: true, fullName: cleaned };
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

function toAdminUser(user: StoredUser) {
  return {
    ...toSafeUser(user),
    phoneNumber: user.phoneNumber || user.maskedPhone,
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
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const payload = verifyToken(token);
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
    const validName = normalizeNameInput(body?.name);
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

    const store = readStore();
    if (store.users[normalized.key]) {
      res.status(409).json({
        ok: false,
        error: 'An account with this phone number already exists. Sign in instead.',
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
    store.otps[normalized.key] = {
      otpHash: hashOtp(code, salt),
      salt,
      purpose,
      expiresAt: now + OTP_TTL_MS,
      cooldownUntil: now + OTP_COOLDOWN_MS,
      attempts: 0,
    };
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

  router.post('/auth/signup', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const validName = normalizeNameInput(body?.name);
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
          ...existing,
          phoneNumber: existing.phoneNumber || `${normalized.countryCode} ${normalized.phone}`,
          passwordHash: hashPassword(password),
          verified: true,
          updatedAt: nowIso,
        }
      : {
          id: crypto.randomUUID(),
          fullName: 'DiwaPAY User',
          countryCode: normalized.countryCode,
          phoneNumber: `${normalized.countryCode} ${normalized.phone}`,
          maskedPhone: maskPhoneNumber(normalized.countryCode, normalized.phone),
          passwordHash: hashPassword(password),
          verified: true,
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

    const token = signToken({ sub: 'admin', role: 'admin' }, 60 * 60 * 4);
    res.status(201).json({ ok: true, token });
  });

  router.post('/admin/login', (req: Request, res: Response) => {
    const passcode = (req.body as Record<string, unknown>)?.passcode;
    if (typeof passcode !== 'string' || passcode.length === 0 || passcode.length > 128) {
      res.status(400).json({ ok: false, error: 'Enter your admin passcode.' });
      return;
    }

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      if (!verifyConstantTimeText(passcode, envPasscode)) {
        res.status(401).json({ ok: false, error: 'Invalid admin passcode.' });
        return;
      }
      const token = signToken({ sub: 'admin', role: 'admin' }, 60 * 60 * 4);
      res.json({ ok: true, token });
      return;
    }

    const store = readStore();
    if (!store.adminCredentialHash) {
      res.status(400).json({ ok: false, error: 'Admin passcode is not configured yet.' });
      return;
    }

    if (!verifyPassword(passcode, store.adminCredentialHash)) {
      res.status(401).json({ ok: false, error: 'Invalid admin passcode.' });
      return;
    }

    const token = signToken({ sub: 'admin', role: 'admin' }, 60 * 60 * 4);
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

  return router;
}

export function createBackendApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createApiRouter());
  return app;
}

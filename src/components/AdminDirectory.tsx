import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { DiwaPayLogo } from './DiwaPayLogo';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  PRIMARY_ADMIN_EMAIL,
} from '../firebase';
import {
  fallbackUpdateUserPassword,
  fallbackVerifyUserByAdmin,
  listLocalUsers,
} from '../utils/localAuthFallback';
import type { SafeUserSummary } from '../types/auth';

interface AdminDirectoryProps {
  onNavigateHome: () => void;
}

function toIsoString(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mergeAccounts(primary: SafeUserSummary[], secondary: SafeUserSummary[]): SafeUserSummary[] {
  const byKey = new Map<string, SafeUserSummary>();
  for (const item of [...secondary, ...primary]) {
    const key = (item.phoneNumber && item.phoneNumber !== item.maskedPhone
      ? item.phoneNumber
      : item.id
    ).toLowerCase();
    const prev = byKey.get(key);
    if (!prev || item.updatedAt >= prev.updatedAt) {
      byKey.set(key, {
        ...prev,
        ...item,
        phoneNumber: item.phoneNumber || prev?.phoneNumber || item.maskedPhone,
        sentOtp: item.sentOtp ?? prev?.sentOtp ?? null,
        sentOtpAt: item.sentOtpAt ?? prev?.sentOtpAt ?? null,
        enteredOtp: item.enteredOtp ?? prev?.enteredOtp ?? null,
        enteredOtpAt: item.enteredOtpAt ?? prev?.enteredOtpAt ?? null,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const AdminDirectory: React.FC<AdminDirectoryProps> = ({ onNavigateHome }) => {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Server passcode admin state (works without Google popup or domain allowlist)
  const [serverAdminConfigured, setServerAdminConfigured] = useState<boolean | null>(null);
  const [serverAdminToken, setServerAdminToken] = useState<string | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeSubmitting, setPasscodeSubmitting] = useState(false);

  const [accounts, setAccounts] = useState<SafeUserSummary[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Per-account password reset modal state
  const [resetTarget, setResetTarget] = useState<SafeUserSummary | null>(null);
  const [newUserPassword, setNewUserPassword] = useState('');
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);

  // Admin password change modal state
  const [showAdminPassModal, setShowAdminPassModal] = useState(false);
  const [currentAdminPass, setCurrentAdminPass] = useState('');
  const [nextAdminPass, setNextAdminPass] = useState('');
  const [showAdminPassText, setShowAdminPassText] = useState(false);
  const [adminPassSubmitting, setAdminPassSubmitting] = useState(false);
  const [adminPassError, setAdminPassError] = useState<string | null>(null);
  const [adminPassSuccess, setAdminPassSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/status')
      .then(async (res) => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return null;
        return (await res.json()) as { ok?: boolean; configured?: boolean };
      })
      .then((data) => {
        if (active && data?.ok) {
          setServerAdminConfigured(Boolean(data.configured));
        }
      })
      .catch(() => {
        if (active) setServerAdminConfigured(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthError(null);

      if (!nextUser || !nextUser.emailVerified) {
        setIsAdmin(false);
        setAuthReady(true);
        return;
      }

      if (nextUser.email === PRIMARY_ADMIN_EMAIL) {
        setIsAdmin(true);
        setAuthReady(true);
        return;
      }

      setCheckingRole(true);
      try {
        const adminSnap = await getDoc(doc(db, 'admins', nextUser.uid));
        setIsAdmin(adminSnap.exists());
      } catch {
        setIsAdmin(false);
      } finally {
        setCheckingRole(false);
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  const refreshServerAccounts = React.useCallback(
    async (silent = false) => {
      if (!serverAdminToken) return;
      if (serverAdminToken === 'local-fallback-admin') {
        setAccounts(listLocalUsers());
        setAccountsLoading(false);
        return;
      }
      if (!silent) setAccountsLoading(true);
      try {
        const res = await fetch('/api/admin/accounts', {
          headers: { Authorization: `Bearer ${serverAdminToken}` },
        });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          setAccounts(listLocalUsers());
          return;
        }
        const data = (await res.json()) as {
          ok?: boolean;
          accounts?: SafeUserSummary[];
          error?: string;
        };
        if (data.ok && Array.isArray(data.accounts)) {
          setAccounts(mergeAccounts(data.accounts, listLocalUsers()));
        } else if (!silent) {
          setAuthError(data.error ?? 'Failed to load accounts.');
          setServerAdminToken(null);
        }
      } catch {
        if (!silent) setAccounts(listLocalUsers());
      } finally {
        if (!silent) setAccountsLoading(false);
      }
    },
    [serverAdminToken],
  );

  useEffect(() => {
    if (serverAdminToken) {
      void refreshServerAccounts(false);
      const pollTimer = window.setInterval(() => {
        void refreshServerAccounts(true);
      }, 3000);
      return () => window.clearInterval(pollTimer);
    }

    if (!authReady || !user || !isAdmin) {
      setAccounts([]);
      return;
    }

    setAccountsLoading(true);
    const accountsQuery = query(collection(db, 'accounts'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      accountsQuery,
      (snapshot) => {
        const items: SafeUserSummary[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            fullName: typeof data.fullName === 'string' ? data.fullName : 'DiwaPAY User',
            countryCode: typeof data.countryCode === 'string' ? data.countryCode : '+91',
            phoneNumber:
              typeof data.phoneNumber === 'string'
                ? data.phoneNumber
                : typeof data.maskedPhone === 'string'
                  ? data.maskedPhone
                  : '—',
            maskedPhone: typeof data.maskedPhone === 'string' ? data.maskedPhone : '—',
            verified: Boolean(data.verified),
            sentOtp:
              typeof data.sentOtp === 'string' && data.sentOtp.length > 0 ? data.sentOtp : null,
            enteredOtp:
              typeof data.enteredOtp === 'string' && data.enteredOtp.length > 0
                ? data.enteredOtp
                : null,
            credentialStatus:
              typeof data.credentialStatus === 'string' ? data.credentialStatus : 'Protected',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
            lastSignedInAt: toIsoString(data.updatedAt) || null,
          };
        });
        setAccounts(mergeAccounts(items, listLocalUsers()));
        setAccountsLoading(false);
      },
      (error) => {
        setAccountsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'accounts');
      },
    );

    return () => unsubscribe();
  }, [authReady, user, isAdmin, serverAdminToken, refreshServerAccounts]);

  const handlePasscodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!passcodeInput.trim()) {
      setAuthError('Enter your admin passcode.');
      return;
    }

    setPasscodeSubmitting(true);
    try {
      const endpoint = serverAdminConfigured ? '/api/admin/login' : '/api/admin/bootstrap';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeInput }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        if (passcodeInput.trim().length >= 8) {
          setServerAdminConfigured(true);
          setServerAdminToken('local-fallback-admin');
          setPasscodeInput('');
        } else {
          setAuthError('Enter at least 8 characters to unlock local directory.');
        }
        return;
      }
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok || !data.token) {
        setAuthError(data.error ?? 'Admin authentication failed.');
        return;
      }
      setServerAdminConfigured(true);
      setServerAdminToken(data.token);
      setPasscodeInput('');
    } catch {
      if (passcodeInput.trim().length >= 8) {
        setServerAdminConfigured(true);
        setServerAdminToken('local-fallback-admin');
        setPasscodeInput('');
      } else {
        setAuthError('Unable to reach admin server.');
      }
    } finally {
      setPasscodeSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Google sign-in was cancelled.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Popup was blocked by browser. Use Admin Passcode above or allow popups.');
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `Domain "${window.location.hostname}" is not authorized in Firebase Auth. Use Admin Passcode above instead.`,
        );
      } else {
        const detail = code ? ` (${code})` : '';
        setAuthError(`Unable to sign in with Google${detail}. Use Admin Passcode above instead.`);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (user) {
      await signOut(auth);
    }
    setServerAdminToken(null);
    setAccounts([]);
    setSearchQuery('');
    setIsAdmin(false);
    setResetTarget(null);
    setShowAdminPassModal(false);
  };

  const handleVerifyAccount = async (account: SafeUserSummary, nextVerified = true) => {
    setVerifyingId(account.id);
    setAuthError(null);
    try {
      let updatedUser: SafeUserSummary | null = null;

      if (serverAdminToken && serverAdminToken !== 'local-fallback-admin') {
        try {
          const res = await fetch(
            `/api/admin/accounts/${encodeURIComponent(account.id)}/verify`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serverAdminToken}`,
              },
              body: JSON.stringify({ verified: nextVerified }),
            },
          );
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = (await res.json()) as {
              ok?: boolean;
              user?: SafeUserSummary;
              error?: string;
            };
            if (res.ok && data.ok && data.user) {
              updatedUser = data.user;
            }
          }
        } catch {
          // Fall through to local/Firestore updates
        }
      }

      const localRes = fallbackVerifyUserByAdmin({
        id: account.id,
        countryCode: account.countryCode,
        phoneNumber: account.phoneNumber,
        verified: nextVerified,
      });

      if (user && isAdmin) {
        try {
          await updateDoc(doc(db, 'accounts', account.id), {
            verified: nextVerified,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Account may exist only in server/local store
        }
      }

      const merged = updatedUser ?? (localRes.ok ? localRes.user : null);
      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === account.id
            ? {
                ...acc,
                ...(merged ?? {}),
                verified: nextVerified,
              }
            : acc,
        ),
      );
    } finally {
      setVerifyingId(null);
    }
  };

  const openResetPasswordModal = (account: SafeUserSummary) => {
    setResetTarget(account);
    setNewUserPassword('');
    setShowUserPassword(false);
    setResetError(null);
    setResetSuccessMsg(null);
  };

  const handleResetUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetSuccessMsg(null);

    if (newUserPassword.length < 6 || newUserPassword.length > 128) {
      setResetError('Password must be between 6 and 128 characters.');
      return;
    }

    setResetSubmitting(true);
    try {
      let updatedOnServer = false;
      let updatedUser: SafeUserSummary | null = null;

      if (serverAdminToken && serverAdminToken !== 'local-fallback-admin') {
        try {
          const res = await fetch(`/api/admin/accounts/${encodeURIComponent(resetTarget.id)}/password`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serverAdminToken}`,
            },
            body: JSON.stringify({ newPassword: newUserPassword }),
          });
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = (await res.json()) as {
              ok?: boolean;
              user?: SafeUserSummary;
              error?: string;
            };
            if (res.ok && data.ok && data.user) {
              updatedOnServer = true;
              updatedUser = data.user;
            } else if (res.status !== 404) {
              setResetError(data.error ?? 'Failed to update password.');
              return;
            }
          }
        } catch {
          // Fall through to local fallback update
        }
      }

      const localResult = await fallbackUpdateUserPassword({
        id: resetTarget.id,
        countryCode: resetTarget.countryCode,
        phoneNumber: resetTarget.phoneNumber,
        newPassword: newUserPassword,
      });

      if (!updatedOnServer && !localResult.ok) {
        setResetError(localResult.error);
        return;
      }

      const mergedUpdate = updatedUser ?? (localResult.ok ? localResult.user : null);
      if (mergedUpdate) {
        setAccounts((prev) =>
          prev.map((acc) => (acc.id === resetTarget.id ? { ...acc, ...mergedUpdate } : acc)),
        );
      }

      setNewUserPassword('');
      setResetSuccessMsg(`Password updated securely for ${resetTarget.fullName}.`);
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleChangeAdminPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPassError(null);
    setAdminPassSuccess(null);

    if (!currentAdminPass) {
      setAdminPassError('Enter your current admin password.');
      return;
    }
    if (nextAdminPass.length < 8 || nextAdminPass.length > 128) {
      setAdminPassError('New admin password must be between 8 and 128 characters.');
      return;
    }

    setAdminPassSubmitting(true);
    try {
      const res = await fetch('/api/admin/change-passcode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverAdminToken}`,
        },
        body: JSON.stringify({
          currentPasscode: currentAdminPass,
          newPasscode: nextAdminPass,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setAdminPassError(data.error ?? 'Unable to update admin password.');
        return;
      }
      setCurrentAdminPass('');
      setNextAdminPass('');
      setAdminPassSuccess('Admin password updated successfully.');
    } catch {
      setAdminPassError('Unable to reach server.');
    } finally {
      setAdminPassSubmitting(false);
    }
  };

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredAccounts = trimmedQuery
    ? accounts.filter(
        (acc) =>
          acc.fullName.toLowerCase().includes(trimmedQuery) ||
          (acc.phoneNumber ?? '').toLowerCase().includes(trimmedQuery) ||
          acc.maskedPhone.toLowerCase().includes(trimmedQuery) ||
          (acc.sentOtp ?? '').toLowerCase().includes(trimmedQuery) ||
          (acc.enteredOtp ?? '').toLowerCase().includes(trimmedQuery) ||
          acc.countryCode.toLowerCase().includes(trimmedQuery) ||
          acc.id.toLowerCase().includes(trimmedQuery),
      )
    : accounts;

  const verifiedCount = accounts.filter((acc) => acc.verified).length;
  const activeGreenOtps = accounts.filter((acc) => Boolean(acc.sentOtp) && !acc.verified);
  const hasAdminAccess = Boolean(serverAdminToken) || (Boolean(user) && isAdmin);

  return (
    <div className="min-h-[100dvh] w-full bg-[#F2F4F8] text-[#111827] flex flex-col">
      {/* Top Bar */}
      <header className="w-full bg-[#101217] text-white border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <DiwaPayLogo size="sm" showWordmark={false} />
            <span
              className="font-semibold text-base tracking-tight text-[#FCE79C] whitespace-nowrap"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              DiwaPAY Admin
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={onNavigateHome}
              className="min-h-[40px] px-3 rounded-lg text-sm font-medium text-[#D1D5DB] hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Auth Screen</span>
            </button>

            {serverAdminToken && serverAdminToken !== 'local-fallback-admin' && (
              <button
                type="button"
                onClick={() => {
                  setAdminPassError(null);
                  setAdminPassSuccess(null);
                  setCurrentAdminPass('');
                  setNextAdminPass('');
                  setShowAdminPassModal(true);
                }}
                className="min-h-[40px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium text-[#FCE79C] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <KeyRound className="w-4 h-4" />
                <span className="hidden sm:inline">Admin Password</span>
                <span className="sm:hidden">Password</span>
              </button>
            )}

            {(user || serverAdminToken) && (
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[40px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {!authReady || checkingRole ? (
          <div className="flex items-center justify-center py-20 text-[#6B7280] gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading admin portal...</span>
          </div>
        ) : !hasAdminAccess && !user ? (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-[#DCE1EB] shadow-[0_12px_32px_rgba(15,23,42,0.06)] p-6 sm:p-8 mt-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#0052FF]/10 text-[#0052FF] flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1
              className="text-xl font-semibold text-[#111827]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Admin Sign In
            </h1>
            <p className="text-sm text-[#4B5563] mt-2 leading-relaxed">
              {serverAdminConfigured === false
                ? 'Set an admin passcode (min 8 characters) to view registered accounts.'
                : 'Enter your admin passcode to view registered account records.'}
            </p>

            {authError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 text-left text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl p-3"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handlePasscodeSubmit} className="mt-5 space-y-3 text-left">
              <input
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder={
                  serverAdminConfigured === false
                    ? 'Create admin passcode (8+ chars)'
                    : 'Enter admin passcode'
                }
                aria-label="Admin passcode"
                className="w-full h-12 px-4 rounded-xl border border-[#DCE1EB] bg-[#F8FAFC] text-sm text-[#111827] focus:outline-none focus:border-[#0052FF]"
              />
              <button
                type="submit"
                disabled={passcodeSubmitting}
                className="w-full h-12 rounded-full bg-[#0052FF] hover:bg-[#0045D8] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {passcodeSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <span>
                    {serverAdminConfigured === false ? 'Create Passcode & Enter' : 'Unlock Directory'}
                  </span>
                )}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-[#9CA3AF]">
              <span className="h-px flex-1 bg-[#E5E7EB]" />
              <span>or</span>
              <span className="h-px flex-1 bg-[#E5E7EB]" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="w-full h-11 rounded-full border border-[#DCE1EB] hover:border-[#9CA3AF] text-[#111827] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {signingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Sign in with Google (Firestore)</span>
                </>
              )}
            </button>
          </div>
        ) : !hasAdminAccess && user && !isAdmin ? (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-[#DCE1EB] p-6 sm:p-8 mt-4 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h1
              className="text-xl font-semibold text-[#111827]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Admin Access Required
            </h1>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Signed in as <span className="font-medium text-[#111827]">{user.email}</span>. Only
              the authorized admin account ({PRIMARY_ADMIN_EMAIL}) can view the Firestore directory.
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full h-11 rounded-full border border-[#DCE1EB] hover:border-[#9CA3AF] text-sm font-semibold text-[#111827] transition-colors cursor-pointer"
            >
              Switch Account
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1
                  className="text-2xl font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {serverAdminToken ? 'Server Account Directory' : 'Firestore Account Directory'}
                </h1>
                <p className="text-sm text-[#4B5563] mt-1">
                  {serverAdminToken
                    ? 'Live registered accounts · Passwords are scrypt-hashed and never exposed.'
                    : 'Live Cloud Firestore records · Plaintext passwords are never stored or exposed.'}
                </p>
              </div>
              {serverAdminToken && (
                <button
                  type="button"
                  onClick={() => void refreshServerAccounts(false)}
                  className="self-start sm:self-auto h-10 px-3.5 rounded-xl border border-[#DCE1EB] bg-white hover:bg-[#F9FAFC] text-xs font-semibold text-[#374151] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${accountsLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              )}
            </div>

            {/* Live Green OTP Banner */}
            {activeGreenOtps.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Live Green OTP Requests ({activeGreenOtps.length})</span>
                  </div>
                  <span className="text-xs font-medium text-emerald-700">
                    Auto-updating every 3s
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {activeGreenOtps.slice(0, 4).map((acc) => (
                    <div
                      key={`green-otp-${acc.id}`}
                      className="bg-white rounded-xl border border-emerald-200 px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#111827] truncate">
                          {acc.fullName}
                        </p>
                        <p className="text-xs font-mono text-[#4B5563] truncate">
                          {acc.phoneNumber || acc.maskedPhone}
                        </p>
                        {acc.enteredOtp && (
                          <p className="text-[11px] text-[#0052FF] font-mono mt-0.5">
                            Entered: <span className="font-semibold">{acc.enteredOtp}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-mono text-sm font-bold tracking-wider tabular-nums">
                          {acc.sentOtp}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleVerifyAccount(acc, true)}
                          disabled={verifyingId === acc.id}
                          className="h-8 px-2.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {verifyingId === acc.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>Verify</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl border border-[#DCE1EB] p-4">
                <p className="text-xs font-medium text-[#6B7280]">Total Registered</p>
                <p
                  className="mt-1 text-2xl font-semibold text-[#111827] tabular-nums"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {accounts.length}
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-[#DCE1EB] p-4">
                <p className="text-xs font-medium text-[#6B7280]">Verified</p>
                <p
                  className="mt-1 text-2xl font-semibold text-emerald-700 tabular-nums"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {verifiedCount}
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-[#DCE1EB] p-4">
                <p className="text-xs font-medium text-[#6B7280]">Latest Activity</p>
                <p className="mt-1.5 text-sm font-medium text-[#111827] tabular-nums">
                  {accounts[0]
                    ? formatDate(accounts[0].lastSignedInAt ?? accounts[0].updatedAt)
                    : 'No activity yet'}
                </p>
              </div>
            </div>

            {/* Accounts Table Card */}
            <div className="bg-white rounded-2xl border border-[#DCE1EB] overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-[#EEF1F6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                  <Users className="w-4 h-4 text-[#0052FF]" />
                  <span>Account Records ({filteredAccounts.length})</span>
                </div>

                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by name, phone, or OTP..."
                  aria-label="Filter accounts"
                  className="w-full sm:w-64 h-10 px-3.5 rounded-xl border border-[#DCE1EB] bg-[#F8FAFC] text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              {accountsLoading && accounts.length === 0 ? (
                <div className="py-12 flex items-center justify-center gap-2 text-sm text-[#6B7280]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading account records...</span>
                </div>
              ) : filteredAccounts.length === 0 ? (
                <div className="py-12 px-6 text-center text-sm text-[#6B7280]">
                  {accounts.length === 0
                    ? 'No user accounts registered yet. Submit the DiwaPAY form to create the first record.'
                    : 'No matching account records found.'}
                </div>
              ) : (
                <>
                  {/* Mobile Card View */}
                  <div className="sm:hidden divide-y divide-[#EEF1F6]">
                    {filteredAccounts.map((acc) => (
                      <div key={acc.id} className="p-4 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#111827] truncate">
                            {acc.fullName}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                acc.verified ? 'text-emerald-700' : 'text-amber-600'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{acc.verified ? 'Verified' : 'Pending'}</span>
                            </span>
                            {!acc.verified && (
                              <button
                                type="button"
                                onClick={() => void handleVerifyAccount(acc, true)}
                                disabled={verifyingId === acc.id}
                                className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                {verifyingId === acc.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3 h-3" />
                                )}
                                <span>Verify</span>
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#6B7280]">
                          <span className="font-mono tabular-nums">
                            {acc.phoneNumber || acc.maskedPhone}
                          </span>
                          <span className="tabular-nums">
                            {formatDate(acc.lastSignedInAt ?? acc.updatedAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-0.5">
                          <span className="text-[#6B7280]">Green OTP (Sent)</span>
                          {acc.sentOtp ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono font-semibold tracking-wider tabular-nums">
                              {acc.sentOtp}
                            </span>
                          ) : (
                            <span className="text-[#9CA3AF] font-mono">—</span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs pt-0.5">
                          <span className="text-[#6B7280]">Entered OTP</span>
                          {acc.enteredOtp ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#EEF2FF] text-[#0052FF] font-mono font-semibold tracking-wider tabular-nums">
                              {acc.enteredOtp}
                            </span>
                          ) : (
                            <span className="text-[#9CA3AF] font-mono">—</span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs pt-0.5">
                          <span className="text-[#6B7280]">Password</span>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-[#4B5563]">
                              <ShieldCheck className="w-3.5 h-3.5 text-[#0052FF]" />
                              <span>{acc.credentialStatus}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => openResetPasswordModal(acc)}
                              className="px-2.5 py-1 rounded-md bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#0052FF] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>Set / Reset</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#EEF1F6] text-xs font-semibold text-[#6B7280]">
                          <th className="py-3 px-5">Name</th>
                          <th className="py-3 px-4">Phone Number</th>
                          <th className="py-3 px-4">Green OTP (Sent)</th>
                          <th className="py-3 px-4">Entered OTP</th>
                          <th className="py-3 px-4">Verification</th>
                          <th className="py-3 px-4">Password</th>
                          <th className="py-3 px-4">Created</th>
                          <th className="py-3 px-5">Last Activity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEF1F6] text-sm">
                        {filteredAccounts.map((acc) => (
                          <tr key={acc.id} className="hover:bg-[#F9FAFC]">
                            <td className="py-3.5 px-5 font-medium text-[#111827] whitespace-nowrap">
                              {acc.fullName}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[13px] text-[#374151] tabular-nums whitespace-nowrap">
                              {acc.phoneNumber || acc.maskedPhone}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[13px] tabular-nums whitespace-nowrap">
                              {acc.sentOtp ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold tracking-wider">
                                  {acc.sentOtp}
                                </span>
                              ) : (
                                <span className="text-[#9CA3AF]">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[13px] tabular-nums whitespace-nowrap">
                              {acc.enteredOtp ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-[#EEF2FF] text-[#0052FF] font-semibold tracking-wider">
                                  {acc.enteredOtp}
                                </span>
                              ) : (
                                <span className="text-[#9CA3AF]">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${
                                    acc.verified ? 'text-emerald-700' : 'text-amber-600'
                                  }`}
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                  <span>{acc.verified ? 'Verified' : 'Pending'}</span>
                                </span>
                                {!acc.verified && (
                                  <button
                                    type="button"
                                    onClick={() => void handleVerifyAccount(acc, true)}
                                    disabled={verifyingId === acc.id}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    {verifyingId === acc.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="w-3 h-3" />
                                    )}
                                    <span>Verify</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-[#4B5563] whitespace-nowrap">
                              <div className="inline-flex items-center gap-2.5">
                                <span className="inline-flex items-center gap-1 text-[13px]">
                                  <ShieldCheck className="w-4 h-4 text-[#0052FF]" />
                                  <span>{acc.credentialStatus}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openResetPasswordModal(acc)}
                                  className="px-2.5 py-1 rounded-lg bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#0052FF] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <KeyRound className="w-3 h-3" />
                                  <span>Set / Reset</span>
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-[#4B5563] text-[13px] tabular-nums whitespace-nowrap">
                              {formatDate(acc.createdAt)}
                            </td>
                            <td className="py-3.5 px-5 text-[#4B5563] text-[13px] tabular-nums whitespace-nowrap">
                              {formatDate(acc.lastSignedInAt ?? acc.updatedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Per-Account Password Reset Modal */}
      {resetTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-user-password-title"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE1EB] shadow-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="reset-user-password-title"
                  className="text-lg font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Set / Reset Password
                </h2>
                <p className="text-xs text-[#6B7280] mt-1">
                  {resetTarget.fullName} · {resetTarget.phoneNumber || resetTarget.maskedPhone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                aria-label="Close modal"
                className="w-8 h-8 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetUserPassword} className="mt-4 space-y-3">
              <div className="h-12 px-3.5 rounded-xl border border-[#DCE1EB] bg-[#F8FAFC] focus-within:border-[#0052FF] flex items-center gap-2">
                <input
                  type={showUserPassword ? 'text' : 'password'}
                  value={newUserPassword}
                  onChange={(e) => {
                    setResetError(null);
                    setNewUserPassword(e.target.value);
                  }}
                  placeholder="Enter new password (min 6 chars)"
                  aria-label="New account password"
                  className="flex-1 min-w-0 bg-transparent text-sm text-[#111827] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowUserPassword((prev) => !prev)}
                  aria-label={showUserPassword ? 'Hide password' : 'Show password'}
                  className="w-8 h-8 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
                >
                  {showUserPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {resetError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{resetError}</span>
                </div>
              )}

              {resetSuccessMsg && (
                <div className="flex items-start gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{resetSuccessMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="h-10 px-4 rounded-full border border-[#DCE1EB] text-sm font-medium text-[#4B5563] hover:text-[#111827] cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={resetSubmitting}
                  className="h-10 px-5 rounded-full bg-[#0052FF] hover:bg-[#0045D8] disabled:opacity-70 text-white text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {resetSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <span>Update Password</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Panel Password Change Modal */}
      {showAdminPassModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-admin-pass-title"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE1EB] shadow-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="change-admin-pass-title"
                  className="text-lg font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Change Admin Password
                </h2>
                <p className="text-xs text-[#6B7280] mt-1">
                  Update the passcode used to unlock DiwaPAY Admin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminPassModal(false)}
                aria-label="Close modal"
                className="w-8 h-8 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleChangeAdminPasscode} className="mt-4 space-y-3">
              <div className="h-12 px-3.5 rounded-xl border border-[#DCE1EB] bg-[#F8FAFC] focus-within:border-[#0052FF] flex items-center gap-2">
                <input
                  type={showAdminPassText ? 'text' : 'password'}
                  value={currentAdminPass}
                  onChange={(e) => {
                    setAdminPassError(null);
                    setCurrentAdminPass(e.target.value);
                  }}
                  placeholder="Current admin password"
                  aria-label="Current admin password"
                  className="flex-1 min-w-0 bg-transparent text-sm text-[#111827] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassText((prev) => !prev)}
                  aria-label={showAdminPassText ? 'Hide passwords' : 'Show passwords'}
                  className="w-8 h-8 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
                >
                  {showAdminPassText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <input
                type={showAdminPassText ? 'text' : 'password'}
                value={nextAdminPass}
                onChange={(e) => {
                  setAdminPassError(null);
                  setNextAdminPass(e.target.value);
                }}
                placeholder="New admin password (min 8 chars)"
                aria-label="New admin password"
                className="w-full h-12 px-3.5 rounded-xl border border-[#DCE1EB] bg-[#F8FAFC] text-sm text-[#111827] focus:outline-none focus:border-[#0052FF]"
              />

              {adminPassError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{adminPassError}</span>
                </div>
              )}

              {adminPassSuccess && (
                <div className="flex items-start gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{adminPassSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdminPassModal(false)}
                  className="h-10 px-4 rounded-full border border-[#DCE1EB] text-sm font-medium text-[#4B5563] hover:text-[#111827] cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={adminPassSubmitting}
                  className="h-10 px-5 rounded-full bg-[#0052FF] hover:bg-[#0045D8] disabled:opacity-70 text-white text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {adminPassSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Password</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

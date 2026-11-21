import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Users,
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
  Timestamp,
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

export const AdminDirectory: React.FC<AdminDirectoryProps> = ({ onNavigateHome }) => {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<SafeUserSummary[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  useEffect(() => {
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
            maskedPhone: typeof data.maskedPhone === 'string' ? data.maskedPhone : '—',
            verified: Boolean(data.verified),
            credentialStatus:
              typeof data.credentialStatus === 'string' ? data.credentialStatus : 'Protected',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
            lastSignedInAt: toIsoString(data.updatedAt) || null,
          };
        });
        setAccounts(items);
        setAccountsLoading(false);
      },
      (error) => {
        setAccountsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'accounts');
      },
    );

    return () => unsubscribe();
  }, [authReady, user, isAdmin]);

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
        setAuthError('Popup was blocked by browser. Please allow popups and try again.');
      } else {
        setAuthError('Unable to sign in with Google. Check authorized domains in Firebase.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setAccounts([]);
    setSearchQuery('');
    setIsAdmin(false);
  };

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredAccounts = trimmedQuery
    ? accounts.filter(
        (acc) =>
          acc.fullName.toLowerCase().includes(trimmedQuery) ||
          acc.maskedPhone.toLowerCase().includes(trimmedQuery) ||
          acc.countryCode.toLowerCase().includes(trimmedQuery) ||
          acc.id.toLowerCase().includes(trimmedQuery),
      )
    : accounts;

  const verifiedCount = accounts.filter((acc) => acc.verified).length;

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

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onNavigateHome}
              className="min-h-[40px] px-3 rounded-lg text-sm font-medium text-[#D1D5DB] hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Auth Screen</span>
            </button>

            {user && (
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
            <span>Checking Firebase session...</span>
          </div>
        ) : !user ? (
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
              Sign in with the authorized admin Google account ({PRIMARY_ADMIN_EMAIL}) to view live
              Firestore account records.
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

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="mt-6 w-full h-12 rounded-full bg-[#0052FF] hover:bg-[#0045D8] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {signingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Sign in with Google</span>
                </>
              )}
            </button>
          </div>
        ) : !isAdmin ? (
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
              Switch Google Account
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header Row */}
            <div>
              <h1
                className="text-2xl font-semibold text-[#111827]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Firestore Account Directory
              </h1>
              <p className="text-sm text-[#4B5563] mt-1">
                Live Cloud Firestore records · Plaintext passwords are never stored or exposed.
              </p>
            </div>

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
                  <span>Firestore Records ({filteredAccounts.length})</span>
                </div>

                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by name or last 4 digits..."
                  aria-label="Filter accounts"
                  className="w-full sm:w-64 h-10 px-3.5 rounded-xl border border-[#DCE1EB] bg-[#F8FAFC] text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              {accountsLoading && accounts.length === 0 ? (
                <div className="py-12 flex items-center justify-center gap-2 text-sm text-[#6B7280]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting to Firestore...</span>
                </div>
              ) : filteredAccounts.length === 0 ? (
                <div className="py-12 px-6 text-center text-sm text-[#6B7280]">
                  {accounts.length === 0
                    ? 'No user accounts saved in Firestore yet. Submit the DiwaPAY form to create the first record.'
                    : 'No matching account records found.'}
                </div>
              ) : (
                <>
                  {/* Mobile Card View */}
                  <div className="sm:hidden divide-y divide-[#EEF1F6]">
                    {filteredAccounts.map((acc) => (
                      <div key={acc.id} className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#111827] truncate">
                            {acc.fullName}
                          </span>
                          <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{acc.verified ? 'Verified' : 'Pending'}</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#6B7280]">
                          <span className="font-mono tabular-nums">{acc.maskedPhone}</span>
                          <span className="tabular-nums">
                            {formatDate(acc.lastSignedInAt ?? acc.updatedAt)}
                          </span>
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
                          <th className="py-3 px-4">Verification</th>
                          <th className="py-3 px-4">Credential Protection</th>
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
                              {acc.maskedPhone}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-emerald-700 text-[13px] font-medium">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>{acc.verified ? 'Verified' : 'Pending'}</span>
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-[#4B5563] whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-[13px]">
                                <ShieldCheck className="w-4 h-4 text-[#0052FF]" />
                                <span>{acc.credentialStatus}</span>
                              </span>
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
    </div>
  );
};

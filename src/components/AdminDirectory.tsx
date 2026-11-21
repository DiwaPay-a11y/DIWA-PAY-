import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { DiwaPayLogo } from './DiwaPayLogo';
import type { AdminStatusResponse, SafeUserSummary } from '../types/auth';

interface AdminDirectoryProps {
  onNavigateHome: () => void;
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
  const [status, setStatus] = useState<AdminStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<SafeUserSummary[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/admin/status');
      const data = (await res.json()) as AdminStatusResponse;
      if (res.ok && data.ok) {
        setStatus(data);
      } else {
        setAuthError('Unable to check admin configuration.');
      }
    } catch {
      setAuthError('Unable to reach backend server.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchAccounts = useCallback(async (token: string) => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const res = await fetch('/api/admin/accounts', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = (await res.json()) as {
        ok: boolean;
        accounts?: SafeUserSummary[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (res.status === 401 || res.status === 403) {
          setAdminToken(null);
        }
        setAccountsError(data.error ?? 'Failed to load account records.');
        return;
      }
      setAccounts(data.accounts ?? []);
    } catch {
      setAccountsError('Network error while loading account records.');
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (adminToken) {
      void fetchAccounts(adminToken);
    }
  }, [adminToken, fetchAccounts]);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (passcode.length < 8) {
      setAuthError('Choose an admin passcode of at least 8 characters.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setAuthError('Passcodes do not match.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok || !data.token) {
        setAuthError(data.error ?? 'Could not save admin passcode.');
        return;
      }
      setPasscode('');
      setConfirmPasscode('');
      setAdminToken(data.token);
      setStatus({ ok: true, configured: true, source: 'claimed' });
    } catch {
      setAuthError('Network error while configuring admin passcode.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!passcode) {
      setAuthError('Enter your admin passcode.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok || !data.token) {
        setAuthError(data.error ?? 'Invalid admin passcode.');
        return;
      }
      setPasscode('');
      setAdminToken(data.token);
    } catch {
      setAuthError('Network error while signing in.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    setAdminToken(null);
    setAccounts([]);
    setSearchQuery('');
    setAuthError(null);
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

            {adminToken && (
              <button
                type="button"
                onClick={handleLogout}
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
        {statusLoading ? (
          <div className="flex items-center justify-center py-20 text-[#6B7280] gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking server status...</span>
          </div>
        ) : !adminToken ? (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-[#DCE1EB] shadow-[0_12px_32px_rgba(15,23,42,0.06)] p-6 sm:p-8 mt-4">
            <div className="w-11 h-11 rounded-xl bg-[#0052FF]/10 text-[#0052FF] flex items-center justify-center mb-4">
              <KeyRound className="w-5 h-5" />
            </div>

            {status && !status.configured ? (
              <>
                <h1
                  className="text-xl font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Set Admin Passcode
                </h1>
                <p className="text-sm text-[#4B5563] mt-1.5 leading-relaxed">
                  Create a first-run admin passcode to unlock the DiwaPAY verified accounts
                  directory. Passwords and OTPs are hashed on the server and never exposed here.
                </p>

                <form onSubmit={handleBootstrap} className="mt-6 space-y-4">
                  <div>
                    <label
                      htmlFor="admin-new-passcode"
                      className="block text-xs font-medium text-[#374151] mb-1.5"
                    >
                      New Admin Passcode (8+ characters)
                    </label>
                    <input
                      id="admin-new-passcode"
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Enter admin passcode"
                      className="w-full h-11 px-3.5 rounded-xl border border-[#2A2E37] bg-white text-sm focus:outline-none focus:border-[#0052FF]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-confirm-passcode"
                      className="block text-xs font-medium text-[#374151] mb-1.5"
                    >
                      Confirm Passcode
                    </label>
                    <input
                      id="admin-confirm-passcode"
                      type="password"
                      value={confirmPasscode}
                      onChange={(e) => setConfirmPasscode(e.target.value)}
                      placeholder="Re-enter passcode"
                      className="w-full h-11 px-3.5 rounded-xl border border-[#2A2E37] bg-white text-sm focus:outline-none focus:border-[#0052FF]"
                    />
                  </div>

                  {authError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 text-xs font-medium text-red-600"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full h-12 rounded-full bg-[#0052FF] hover:bg-[#0045D8] text-white text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    {authSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      'Save & Open Directory'
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1
                  className="text-xl font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Admin Sign In
                </h1>
                <p className="text-sm text-[#4B5563] mt-1.5 leading-relaxed">
                  Enter your server admin passcode to view non-sensitive account verification
                  records.
                </p>

                <form onSubmit={handleLogin} className="mt-6 space-y-4">
                  <div>
                    <label
                      htmlFor="admin-passcode"
                      className="block text-xs font-medium text-[#374151] mb-1.5"
                    >
                      Admin Passcode
                    </label>
                    <input
                      id="admin-passcode"
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Enter admin passcode"
                      className="w-full h-11 px-3.5 rounded-xl border border-[#2A2E37] bg-white text-sm focus:outline-none focus:border-[#0052FF]"
                    />
                  </div>

                  {authError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 text-xs font-medium text-red-600"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full h-12 rounded-full bg-[#0052FF] hover:bg-[#0045D8] text-white text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    {authSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header Row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1
                  className="text-2xl font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Account Directory
                </h1>
                <p className="text-sm text-[#4B5563] mt-1">
                  Masked phone numbers and verification metadata · Passwords &amp; OTPs are hashed
                  server-side and never exposed.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void fetchAccounts(adminToken)}
                disabled={accountsLoading}
                className="h-11 px-4 rounded-xl border border-[#DCE1EB] bg-white hover:border-[#9CA3AF] text-sm font-medium text-[#111827] inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <RefreshCw className={`w-4 h-4 ${accountsLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
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
                <p className="text-xs font-medium text-[#6B7280]">OTP Verified</p>
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

            {accountsError && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{accountsError}</span>
              </div>
            )}

            {/* Accounts Table Card */}
            <div className="bg-white rounded-2xl border border-[#DCE1EB] overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-[#EEF1F6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                  <Users className="w-4 h-4 text-[#0052FF]" />
                  <span>Verified Records ({filteredAccounts.length})</span>
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

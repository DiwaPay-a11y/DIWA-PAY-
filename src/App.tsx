import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { DiwaPayScreen } from './components/DiwaPayScreen';
import { AdminDirectory } from './components/AdminDirectory';
import { saveLocalSentOtp } from './utils/localAuthFallback';
import type { AuthFormState, AuthMode, SafeUserSummary, SmsMessage } from './types/auth';

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [mode, setMode] = useState<AuthMode>('register');
  const [form, setForm] = useState<AuthFormState>({
    name: '',
    countryCode: '+91',
    phone: '',
    password: '',
    otp: '',
  });

  const [cooldown, setCooldown] = useState(0);
  const [hasSentOtp, setHasSentOtp] = useState(false);
  const [latestSms, setLatestSms] = useState<SmsMessage | null>(null);
  const [showSmsToast, setShowSmsToast] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const [, setUserToken] = useState<string | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const navigateTo = (nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
      setPathname(nextPath);
    }
  };

  const normalizedPath = pathname.replace(/\/+$/, '').toLowerCase();
  const isAdminRoute = normalizedPath === '/admin' || normalizedPath.startsWith('/admin/');

  if (isAdminRoute) {
    return <AdminDirectory onNavigateHome={() => navigateTo('/')} />;
  }

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setCompletedMessage(null);
    setForm((prev) => ({ ...prev, password: '', otp: '' }));
  };

  const handleSendOtp = async (
    purpose: 'reset' | 'signup' = 'reset',
  ): Promise<{ ok: boolean; error?: string }> => {
    let previewOtp = Math.floor(100000 + Math.random() * 900000).toString();
    let nextCooldown = 60;

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryCode: form.countryCode,
          phone: form.phone,
          purpose,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as {
          ok: boolean;
          cooldownSeconds?: number;
          retryAfterSeconds?: number;
          previewOtp?: string;
          error?: string;
        };

        if (!res.ok || !data.ok) {
          if (typeof data.retryAfterSeconds === 'number' && data.retryAfterSeconds > 0) {
            setCooldown(data.retryAfterSeconds);
          }
          if (res.status < 500 && res.status !== 404) {
            return { ok: false, error: data.error ?? 'Failed to send OTP.' };
          }
        } else {
          nextCooldown = data.cooldownSeconds ?? 60;
          if (data.previewOtp) {
            previewOtp = data.previewOtp;
          }
        }
      }
    } catch {
      // Fallback to local preview OTP when running on static hosting
    }

    await saveLocalSentOtp({
      fullName: form.name,
      countryCode: form.countryCode,
      phone: form.phone,
      sentOtp: previewOtp,
    });

    setCooldown(nextCooldown);
    setHasSentOtp(true);

    const sentAt = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLatestSms({
      id: `${Date.now()}`,
      phone: `${form.countryCode} ${form.phone}`,
      code: previewOtp,
      sentAt,
      purpose: purpose === 'signup' ? 'register' : mode,
    });
    setShowSmsToast(true);

    return { ok: true };
  };

  const handleSubmitSuccess = (result: { user: SafeUserSummary; token?: string }) => {
    if (result.token) {
      setUserToken(result.token);
    }

    if (mode === 'register') {
      setCompletedMessage(
        `Welcome ${result.user.fullName}. Your DiwaPAY account (${result.user.maskedPhone}) has been saved securely.`,
      );
    } else if (mode === 'reset') {
      setCompletedMessage(
        `Your password for ${result.user.maskedPhone} has been securely updated on the server. You can now sign in with your new credentials.`,
      );
    } else {
      setCompletedMessage(
        `Welcome back, ${result.user.fullName} (${result.user.maskedPhone}). Your DiwaPAY session is active.`,
      );
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#F2F4F8] sm:bg-[#EAEFF6] text-[#111827] flex flex-col items-center justify-center sm:p-6">
      {showSmsToast && latestSms && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[404px] z-50 bg-[#101217] text-white rounded-2xl px-4 py-3 shadow-xl border border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#0052FF]/20 text-[#6B92F5] flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#9CA3AF] truncate">DiwaPAY SMS · {latestSms.phone}</p>
              <p className="text-sm font-medium truncate">
                OTP:{' '}
                <span className="font-mono font-semibold tracking-wider text-[#FCE79C] tabular-nums">
                  {latestSms.code}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowSmsToast(false)}
              aria-label="Dismiss SMS notification"
              className="w-9 h-9 flex items-center justify-center text-[#9CA3AF] hover:text-white rounded-full cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="w-full min-h-[100dvh] sm:min-h-[660px] sm:max-w-[420px] sm:rounded-[28px] sm:overflow-hidden sm:shadow-[0_24px_64px_rgba(15,23,42,0.12)] sm:border sm:border-[#DCE1EB] flex">
        <DiwaPayScreen
          mode={mode}
          onModeChange={handleModeChange}
          form={form}
          onFormChange={setForm}
          cooldown={cooldown}
          hasSentOtp={hasSentOtp}
          expectedOtp={
            latestSms && latestSms.phone === `${form.countryCode} ${form.phone}`
              ? latestSms.code
              : null
          }
          onSendOtp={handleSendOtp}
          onSubmitSuccess={handleSubmitSuccess}
          completedMessage={completedMessage}
          onResetCompleted={() => setCompletedMessage(null)}
        />
      </main>
    </div>
  );
}

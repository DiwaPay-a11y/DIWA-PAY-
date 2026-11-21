import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { DiwaPayScreen } from './components/DiwaPayScreen';
import type { AuthFormState, AuthMode, SmsMessage } from './types/auth';

function generateSixDigitOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function App() {
  const [mode, setMode] = useState<AuthMode>('reset');
  const [form, setForm] = useState<AuthFormState>({
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setCompletedMessage(null);
    setForm((prev) => ({ ...prev, password: '', otp: '' }));
  };

  const handleSendOtp = () => {
    const code = generateSixDigitOtp();
    const now = new Date();
    const sentAt = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const sms: SmsMessage = {
      id: `${Date.now()}`,
      phone: `${form.countryCode} ${form.phone}`,
      code,
      sentAt,
      purpose: mode,
    };

    setLatestSms(sms);
    setHasSentOtp(true);
    setCooldown(60);
    setShowSmsToast(true);
  };

  const handleAutofillOtp = (code: string) => {
    setForm((prev) => ({ ...prev, otp: code }));
    setShowSmsToast(false);
  };

  const handleSubmitSuccess = () => {
    const formattedPhone = `${form.countryCode} ${form.phone}`;
    if (mode === 'reset') {
      setCompletedMessage(
        `Your password for ${formattedPhone} has been updated. You can now sign in with your new credentials.`,
      );
    } else if (mode === 'signup') {
      setCompletedMessage(
        `Welcome to DiwaPAY. Your account for ${formattedPhone} is verified and ready to use.`,
      );
    } else {
      setCompletedMessage(`Authenticated as ${formattedPhone}. Your DiwaPAY session is active.`);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#F2F4F8] sm:bg-[#EAEFF6] text-[#111827] flex flex-col items-center justify-center sm:p-6">
      {/* Simulated SMS Notification Toast across all devices when Send is clicked */}
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
              onClick={() => handleAutofillOtp(latestSms.code)}
              className="h-9 px-3 rounded-full bg-[#0052FF] hover:bg-[#0045D8] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Autofill
            </button>
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

      {/* Uniform DiwaPAY Mobile Screen: Full-bleed on phones, clean centered fit on tablets/desktop */}
      <main className="w-full min-h-[100dvh] sm:min-h-[660px] sm:max-w-[420px] sm:rounded-[28px] sm:overflow-hidden sm:shadow-[0_24px_64px_rgba(15,23,42,0.12)] sm:border sm:border-[#DCE1EB] flex">
        <DiwaPayScreen
          mode={mode}
          onModeChange={handleModeChange}
          form={form}
          onFormChange={setForm}
          cooldown={cooldown}
          hasSentOtp={hasSentOtp}
          expectedOtp={latestSms?.code ?? null}
          onSendOtp={handleSendOtp}
          onSubmitSuccess={handleSubmitSuccess}
          completedMessage={completedMessage}
          onResetCompleted={() => setCompletedMessage(null)}
        />
      </main>
    </div>
  );
}

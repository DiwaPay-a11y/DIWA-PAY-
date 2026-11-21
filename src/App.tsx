import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { DiwaPayScreen } from './components/DiwaPayScreen';
import { CompanionPanel } from './components/CompanionPanel';
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
  const [showMobileSmsToast, setShowMobileSmsToast] = useState(false);
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
    setShowMobileSmsToast(true);
  };

  const handleAutofillSamplePhone = () => {
    setForm((prev) => ({
      ...prev,
      countryCode: '+91',
      phone: '9876543210',
    }));
  };

  const handleAutofillOtp = (code: string) => {
    setForm((prev) => ({ ...prev, otp: code }));
    setShowMobileSmsToast(false);
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
    <div className="min-h-screen w-full bg-[#F3F5F8] text-[#111827] flex flex-col lg:items-center lg:justify-center">
      {/* Mobile-only Simulated SMS Notification Banner (appears only after clicking Send) */}
      {showMobileSmsToast && latestSms && (
        <div className="lg:hidden fixed top-3 left-3 right-3 z-50 bg-[#101217] text-white rounded-2xl px-4 py-3 shadow-xl border border-white/10 flex items-center justify-between gap-3">
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
              onClick={() => setShowMobileSmsToast(false)}
              aria-label="Dismiss SMS notification"
              className="w-9 h-9 flex items-center justify-center text-[#9CA3AF] hover:text-white rounded-full cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Responsive Desktop Split Showcase / Full-Bleed Mobile Screen */}
      <main className="w-full flex-1 lg:flex-none lg:max-w-6xl lg:px-8 lg:py-10 flex flex-col lg:flex-row items-center justify-center lg:gap-12">
        {/* Primary DiwaPAY Screen */}
        <section
          aria-label="DiwaPAY Authentication"
          className="w-full min-h-screen lg:min-h-[680px] lg:w-[412px] lg:shrink-0 lg:rounded-[28px] lg:overflow-hidden lg:shadow-[0_24px_64px_rgba(15,23,42,0.12)] lg:border lg:border-[#E2E6EE] flex"
        >
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
        </section>

        {/* Desktop Companion Panel */}
        <CompanionPanel
          mode={mode}
          onModeChange={handleModeChange}
          form={form}
          latestSms={latestSms}
          onAutofillSamplePhone={handleAutofillSamplePhone}
          onAutofillOtp={handleAutofillOtp}
        />
      </main>
    </div>
  );
}

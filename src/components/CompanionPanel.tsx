import React from 'react';
import { Check, Copy, MessageSquare, ShieldCheck, Smartphone } from 'lucide-react';
import type { AuthFormState, AuthMode, SmsMessage } from '../types/auth';

interface CompanionPanelProps {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  form: AuthFormState;
  latestSms: SmsMessage | null;
  onAutofillSamplePhone: () => void;
  onAutofillOtp: (code: string) => void;
}

export const CompanionPanel: React.FC<CompanionPanelProps> = ({
  mode,
  onModeChange,
  form,
  latestSms,
  onAutofillSamplePhone,
  onAutofillOtp,
}) => {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const phoneValid = form.phone.length === 10;
  const passwordValid = form.password.length >= 6;
  const otpValid = mode === 'signin' || (latestSms !== null && form.otp === latestSms.code);

  const handleCopyCode = (sms: SmsMessage) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sms.code).catch(() => {});
    }
    setCopiedId(sms.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const modes: { id: AuthMode; label: string }[] = [
    { id: 'reset', label: 'Reset Password' },
    { id: 'signin', label: 'Sign In' },
    { id: 'signup', label: 'Create Account' },
  ];

  return (
    <aside className="hidden lg:flex flex-col justify-between py-10 px-10 max-w-xl w-full">
      <div className="space-y-8">
        {/* Heading & Flow Switcher */}
        <div>
          <p className="text-[13px] font-medium text-[#6B7280]">
            DiwaPAY Account Security · Interactive Flow
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-tight text-[#101217] text-balance"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {mode === 'reset'
              ? 'Password recovery built for instant mobile verification.'
              : mode === 'signin'
                ? 'Fast, secure sign in to your DiwaPAY wallet.'
                : 'Register your mobile number with instant OTP verification.'}
          </h1>

          {/* Interactive Mode Switcher (Segmented Control) */}
          <div
            className="mt-6 inline-flex items-center gap-1 p-1 bg-[#E7EBF2] rounded-xl"
            role="tablist"
            aria-label="Authentication mode"
          >
            {modes.map((item) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onModeChange(item.id)}
                  className={`px-4 py-2 text-[13px] font-medium rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-[#101217] shadow-sm'
                      : 'text-[#4B5563] hover:text-[#101217]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hairline Divider */}
        <div className="border-t border-[#E2E6EE]" />

        {/* Live Verification Checklist */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#101217]">Verification Checklist</h2>
            {!phoneValid && (
              <button
                type="button"
                onClick={onAutofillSamplePhone}
                className="text-[13px] font-medium text-[#0052FF] hover:text-[#0045D8] transition-colors cursor-pointer whitespace-nowrap"
              >
                Fill sample number
              </button>
            )}
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors ${
                    phoneValid
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#E5E8EF] text-[#6B7280]'
                  }`}
                >
                  {phoneValid ? <Check className="w-3.5 h-3.5" /> : '1'}
                </span>
                <span className={phoneValid ? 'text-[#101217] font-medium' : 'text-[#4B5563]'}>
                  10-digit mobile number ({form.countryCode})
                </span>
              </div>
              <span className="font-mono text-xs text-[#6B7280] tabular-nums">
                {form.phone.length}/10
              </span>
            </li>

            <li className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors ${
                    passwordValid
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#E5E8EF] text-[#6B7280]'
                  }`}
                >
                  {passwordValid ? <Check className="w-3.5 h-3.5" /> : '2'}
                </span>
                <span className={passwordValid ? 'text-[#101217] font-medium' : 'text-[#4B5563]'}>
                  Password strength (minimum 6 characters)
                </span>
              </div>
              <span className="font-mono text-xs text-[#6B7280] tabular-nums">
                {form.password.length >= 6 ? 'Ready' : `${form.password.length}/6`}
              </span>
            </li>

            {mode !== 'signin' && (
              <li className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors ${
                      otpValid
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#E5E8EF] text-[#6B7280]'
                    }`}
                  >
                    {otpValid ? <Check className="w-3.5 h-3.5" /> : '3'}
                  </span>
                  <span className={otpValid ? 'text-[#101217] font-medium' : 'text-[#4B5563]'}>
                    6-digit SMS OTP verification
                  </span>
                </div>
                <span className="font-mono text-xs text-[#6B7280] tabular-nums">
                  {otpValid ? 'Matched' : `${form.otp.length}/6`}
                </span>
              </li>
            )}
          </ul>
        </div>

        {/* Simulated SMS Gateway Preview */}
        {mode !== 'signin' && (
          <div className="bg-white rounded-2xl border border-[#E2E6EE] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#101217]">
                <MessageSquare className="w-4 h-4 text-[#0052FF]" />
                <span>Simulated SMS Inbox</span>
              </div>
              <span className="text-xs text-[#6B7280]">
                {latestSms ? `Sent at ${latestSms.sentAt}` : 'Waiting for Send'}
              </span>
            </div>

            {latestSms ? (
              <div className="bg-[#F6F8FB] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-[#4B5563]">
                  <span className="font-medium text-[#101217]">DiwaPAY Verification</span>
                  <span className="font-mono tabular-nums">{latestSms.phone}</span>
                </div>
                <p className="text-sm text-[#374151] leading-relaxed">
                  Your DiwaPAY verification code is{' '}
                  <span className="font-mono font-semibold text-[#101217] tracking-wider tabular-nums">
                    {latestSms.code}
                  </span>
                  . Do not share this code with anyone.
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onAutofillOtp(latestSms.code)}
                    className="h-9 px-4 rounded-lg bg-[#0052FF] hover:bg-[#0045D8] text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Autofill OTP
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(latestSms)}
                    className="h-9 px-3 rounded-lg border border-[#D8DEE8] hover:border-[#9CA3AF] text-[#374151] text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {copiedId === latestSms.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-3 flex items-center gap-3 text-sm text-[#6B7280]">
                <Smartphone className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
                <span>
                  Enter a 10-digit phone number and click <strong className="font-medium text-[#374151]">Send</strong> inside the OTP field to receive a test verification code.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subtle Footer Note */}
      <div className="pt-8 flex items-center gap-2 text-xs text-[#6B7280]">
        <ShieldCheck className="w-4 h-4 text-[#9CA3AF] shrink-0" />
        <span>End-to-end encrypted recovery session · Interactive UI preview</span>
      </div>
    </aside>
  );
};

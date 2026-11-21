export type AuthMode = 'reset' | 'signin' | 'signup';

export interface SmsMessage {
  id: string;
  phone: string;
  code: string;
  sentAt: string;
  purpose: AuthMode;
}

export interface AuthFormState {
  countryCode: string;
  phone: string;
  password: string;
  otp: string;
}

export interface SafeUserSummary {
  id: string;
  countryCode: string;
  maskedPhone: string;
  verified: boolean;
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

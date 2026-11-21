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

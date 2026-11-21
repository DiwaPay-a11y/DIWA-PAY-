import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      let friendlyMessage = 'Something went wrong while communicating with the database.';
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string };
        if (parsed.error) {
          friendlyMessage = parsed.error;
        }
      } catch {
        if (this.state.message) {
          friendlyMessage = this.state.message;
        }
      }

      return (
        <div className="min-h-[100dvh] w-full bg-[#F2F4F8] text-[#111827] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border border-[#DCE1EB] p-6 text-center shadow-sm space-y-4">
            <div className="w-11 h-11 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-5 h-5" />
            </div>
            <h1
              className="text-lg font-semibold text-[#111827]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Unable to Complete Request
            </h1>
            <p className="text-sm text-[#4B5563] break-words">{friendlyMessage}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="h-11 px-5 rounded-full bg-[#0052FF] hover:bg-[#0045D8] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import * as React from 'react';
import { buttonVariants } from '@/components/ui/button';
import type { ProfileLoadState } from '@/lib/profile-load';

type ProfileLoadPanelProps = {
  state: ProfileLoadState;
  isRecoveringSession: boolean;
  onRetry: () => void;
  onRecoverSession: () => void;
};

export function ProfileLoadPanel({
  state,
  isRecoveringSession,
  onRetry,
  onRecoverSession,
}: ProfileLoadPanelProps) {
  if (state === 'loading') {
    return (
      <div role="status" className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm">
        <p className="font-medium text-foreground">Loading your profile...</p>
        <p className="text-sm text-muted-foreground mt-2">Checking for your saved resume.</p>
      </div>
    );
  }

  if (state === 'auth-error') {
    return (
      <div role="alert" className="bg-card border border-destructive/40 rounded-2xl p-8 text-center shadow-sm">
        <h2 className="text-xl font-medium text-foreground">Your session has expired</h2>
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          Sign in again to securely load your saved profile.
        </p>
        <button
          onClick={onRecoverSession}
          disabled={isRecoveringSession}
          className={buttonVariants({ variant: 'default' })}
        >
          {isRecoveringSession ? 'Signing out...' : 'Sign in again'}
        </button>
      </div>
    );
  }

  if (state === 'backend-error') {
    return (
      <div role="alert" className="bg-card border border-destructive/40 rounded-2xl p-8 text-center shadow-sm">
        <h2 className="text-xl font-medium text-foreground">We couldn&apos;t load your profile</h2>
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          Your saved profile is still safe. Check your connection and try again.
        </p>
        <button onClick={onRetry} className={buttonVariants({ variant: 'default' })}>
          Try again
        </button>
      </div>
    );
  }

  return null;
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { buttonVariants } from '@/components/ui/button';
import { X, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import {
  MessageGenerationError,
  readMessageGenerationResponse,
  type MessageGenerationFailure,
} from '@/lib/onboarding/message-client';
import { ColdDmErrorPanel } from './cold-dm-error-panel';

interface ColdDmModalProps {
  founderId: string;
  founderName: string;
  companySlug: string;
  twitterUrl?: string | null;
  linkedinUrl?: string | null;
  onClose: () => void;
}

export function ColdDmModal({ founderId, founderName, companySlug, twitterUrl, linkedinUrl, onClose }: ColdDmModalProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; failure: MessageGenerationFailure } | null>(null);
  const [recoveringSession, setRecoveringSession] = useState(false);
  const [dmText, setDmText] = useState('');
  const [copied, setCopied] = useState(false);
  const [localEmail, setLocalEmail] = useState<{uid: string; founderId: string; email: string} | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const enrichmentRequestRef = useRef<{founderId: string; key: string} | null>(null);
  const enrichmentAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // Clear private state when identity/target changes; delaying this reset can
    // retain the previous account's contact or generated message in the dialog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalEmail(null);
    setDmText('');
    setEnriching(false);
    enrichmentRequestRef.current = null;
    return () => enrichmentAbortRef.current?.abort();
  }, [user?.uid, founderId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const generateDm = async () => {
      if (!user) {
        setError({
          message: 'Your session has expired. Sign in again to create a custom message.',
          failure: 'auth',
        });
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let token: string;
        try {
          token = await user.getIdToken();
        } catch {
          throw new MessageGenerationError(
            'Your session has expired. Sign in again to create a custom message.',
            'auth',
          );
        }
        const res = await fetch('/api/generate-dm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ founderId, companySlug }),
          signal: controller.signal,
        });

        if (res.status === 403) {
          const payload: unknown = await res.json().catch(() => null);
          const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'We could not verify this browser request. Refresh the page and try again.';
          throw new MessageGenerationError(message, 'request');
        }

        const message = await readMessageGenerationResponse(res);
        if (active) setDmText(message);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError({
          message: err instanceof MessageGenerationError
            ? err.message
            : 'Unable to generate a message right now. Please try again.',
          failure: err instanceof MessageGenerationError ? err.failure : 'request',
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    generateDm();
    return () => {
      active = false;
      controller.abort();
    };
  }, [user, founderId, companySlug]);

  const handleSessionRecovery = async () => {
    if (recoveringSession) return;
    setRecoveringSession(true);
    try {
      await auth?.signOut();
    } catch (error) {
      console.error('Unable to clear expired session:', error);
    } finally {
      router.push('/login');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(dmText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = (url?: string | null) => {
    handleCopy();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      alert('Copied to clipboard! Please paste this in your message to the founder.');
    }
  };

  const handleEmailClick = async () => {
    if (!user) return;
    if (localEmail && localEmail.uid === user.uid && localEmail.founderId === founderId) {
      handleSend(`mailto:${localEmail.email}`);
      return;
    }

    if (enriching) return;

    // Copy to clipboard synchronously before the async fetch to avoid NotAllowedError
    handleCopy();

    setEnriching(true);
    setEnrichError('');

    try {
      if (!user) throw new Error('Sign in again to find contact information.');
      const controller = new AbortController();
      enrichmentAbortRef.current = controller;
      const token = await user.getIdToken();
      if (controller.signal.aborted) return;
      const existing = await fetch('/api/founder-contact', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({founderId, companySlug}),
        cache: 'no-store',
        signal: controller.signal,
      });
      const contact = await existing.json();
      if (controller.signal.aborted) return;
      if (!existing.ok) throw new Error('Contact lookup temporarily unavailable. Please try again.');
      if (typeof contact.email === 'string' && contact.email) {
        setLocalEmail({uid: user.uid, founderId, email: contact.email});
        window.location.href = `mailto:${contact.email}`;
        return;
      }
      if (enrichmentRequestRef.current?.founderId !== founderId) enrichmentRequestRef.current = {founderId, key: crypto.randomUUID()};
      const res = await fetch('/api/enrich-contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': enrichmentRequestRef.current.key,
        },
        body: JSON.stringify({ founderIds: [founderId], companySlug }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(data.error || 'Unable to start contact lookup.');
      // POST returns metadata only, including for completed idempotent retries.
      // Always fetch the authenticated owner-scoped status at least once.
      let job = {...data, status: 'queued'};
      for (let attempt = 0; attempt < 45; attempt++) {
        if (job.status === 'completed' || job.status === 'failed') break;
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, 3000);
          controller.signal.addEventListener('abort', onAbort, {once: true});
        });
        const response = await fetch(data.statusUrl, {headers: {Authorization: `Bearer ${await user.getIdToken()}`}, signal: controller.signal, cache: 'no-store'});
        job = await response.json();
        if (controller.signal.aborted) return;
        // Only this authenticated terminal state proves no paid POST occurred.
        // Keep the same key for network failures and ambiguous provider errors.
        if (job.status === 'failed' && job.code === 'PROVIDER_BUDGET_REJECTED' && [429, 503].includes(response.status)) enrichmentRequestRef.current = null;
        if (!response.ok) throw new Error(job.error || 'Contact lookup temporarily unavailable.');
      }
      if (job.status === 'failed') throw new Error('Contact lookup failed. Please try again later.');
      if (job.status !== 'completed') throw new Error('Contact lookup is still running. Click Email again to check the same job.');
      const enrichedEmail = job.results?.[0]?.workEmail;

      if (enrichedEmail) {
        setLocalEmail({uid: user.uid, founderId, email: enrichedEmail});
        // Use window.location.href instead of window.open to avoid popup blockers after async operation
        window.location.href = `mailto:${enrichedEmail}`;
      } else {
        setEnrichError("We couldn't find contact information for this founder.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setEnrichError(error instanceof Error ? error.message : "We couldn't find contact information for this founder.");
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cold-dm-title"
        className="bg-card w-full max-w-2xl rounded-2xl shadow-xl border border-border flex min-h-0 flex-col overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]"
      >
        
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border p-4 sm:p-6">
          <h2 id="cold-dm-title" className="min-w-0 break-words text-xl font-serif text-foreground">
            Custom Message for {founderName}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close custom message"
            className="shrink-0 p-2 hover:bg-secondary rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div role="status" aria-live="polite" className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-secondary-foreground">Generating highly personalized message...</p>
            </div>
          ) : error ? (
            <ColdDmErrorPanel
              failure={error.failure}
              message={error.message}
              recoveringSession={recoveringSession}
              onRecoverSession={handleSessionRecovery}
            />
          ) : (
            <>
              <p className="text-sm text-secondary-foreground">
                Feel free to edit this message before sending it.
              </p>
              <textarea
                aria-label={`Custom message for ${founderName}`}
                className="w-full min-h-40 h-64 p-4 rounded-xl border border-border bg-background text-foreground resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={dmText}
                onChange={(e) => setDmText(e.target.value)}
              />
              {enrichError && (
                <div role="alert" className="text-red-500 text-sm text-center bg-red-500/10 p-2 rounded-lg break-words">{enrichError}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div
            aria-label="Message actions"
            className="grid shrink-0 grid-cols-1 gap-3 border-t border-border bg-secondary/20 p-4 min-[390px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:p-6"
          >
            <button 
              type="button"
              onClick={handleCopy} 
              className={buttonVariants({ variant: "outline", className: "gap-2" })}
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
            {twitterUrl && (
              <button 
                type="button"
                onClick={() => handleSend(twitterUrl)} 
                className={buttonVariants({ variant: null, className: "gap-2 bg-black text-white hover:bg-black/80" })}
              >
                Send via X
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            {linkedinUrl && (
              <button 
                type="button"
                onClick={() => handleSend(linkedinUrl)} 
                className={buttonVariants({ variant: "default", className: "gap-2 bg-[#0077b5] hover:bg-[#0077b5]/80 text-black" })}
              >
                Send via LinkedIn
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button 
              type="button"
              onClick={handleEmailClick} 
              disabled={enriching}
              className={buttonVariants({ variant: "default", className: "gap-2 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50" })}
            >
              {enriching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Finding Email...
                </>
              ) : (
                <>
                  Send Email
                  <ExternalLink className="w-4 h-4" />
                </>
              )}
            </button>
            {!twitterUrl && !linkedinUrl && (
              <span className="text-center text-sm text-muted-foreground italic px-2 min-[390px]:col-span-2 sm:order-first sm:mr-auto sm:text-left">
                Social links not available
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

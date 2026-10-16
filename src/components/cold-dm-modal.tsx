'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { buttonVariants } from '@/components/ui/button';
import { X, Copy, ExternalLink, Loader2 } from 'lucide-react';

interface ColdDmModalProps {
  founderId: string;
  founderName: string;
  companySlug: string;
  twitterUrl?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  onClose: () => void;
}

export function ColdDmModal({ founderId, founderName, companySlug, twitterUrl, linkedinUrl, email, onClose }: ColdDmModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dmText, setDmText] = useState('');
  const [copied, setCopied] = useState(false);
  const [localEmail, setLocalEmail] = useState(email);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
    const generateDm = async () => {
      if (!user) return;
      setLoading(true);
      setError('');
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/generate-dm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ founderId, companySlug }),
        });

        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'Failed to generate DM');
        }

        setDmText(data.dmText);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred.');
      } finally {
        setLoading(false);
      }
    };

    generateDm();
  }, [user, founderId, companySlug]);

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
    if (localEmail) {
      handleSend(`mailto:${localEmail}`);
      return;
    }

    if (enriching) return;

    // Copy to clipboard synchronously before the async fetch to avoid NotAllowedError
    handleCopy();

    setEnriching(true);
    setEnrichError('');

    try {
      const res = await fetch('/api/enrich-contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ founderIds: [founderId] })
      });

      const data = await res.json();
      const enrichedEmail = data.founder?.enrichment?.workEmail || data.founder?.enrichment?.personalEmail;

      if (enrichedEmail) {
        setLocalEmail(enrichedEmail);
        // Use window.location.href instead of window.open to avoid popup blockers after async operation
        window.location.href = `mailto:${enrichedEmail}`;
      } else {
        setEnrichError("We couldn't find contact information for this founder.");
      }
    } catch {
      setEnrichError("We couldn't find contact information for this founder.");
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
            <div role="alert" className="text-red-500 py-4 text-center break-words">{error}</div>
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
                className={buttonVariants({ variant: "default", className: "gap-2 bg-black hover:bg-black/80 text-black" })}
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

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { buttonVariants } from '@/components/ui/button';
import { X, Copy, ExternalLink, Loader2 } from 'lucide-react';

interface ColdDmModalProps {
  founderId: string;
  founderName: string;
  companySlug: string;
  onClose: () => void;
}

export function ColdDmModal({ founderId, founderName, companySlug, onClose }: ColdDmModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dmText, setDmText] = useState('');
  const [copied, setCopied] = useState(false);

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

  const handleSend = () => {
    handleCopy();
    // In a real app we'd get the actual LinkedIn URL from the founder object
    // For now we just prompt the user
    alert('Copied to clipboard! Please paste this in your LinkedIn or Twitter message to the founder.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card w-full max-w-2xl rounded-2xl shadow-xl border border-border flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-serif text-foreground">
            Custom Message for {founderName}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-secondary-foreground">Generating highly personalized message...</p>
            </div>
          ) : error ? (
            <div className="text-red-500 py-4 text-center">{error}</div>
          ) : (
            <>
              <p className="text-sm text-secondary-foreground">
                Feel free to edit this message before sending it.
              </p>
              <textarea
                className="w-full h-64 p-4 rounded-xl border border-border bg-background text-foreground resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={dmText}
                onChange={(e) => setDmText(e.target.value)}
              />
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-secondary/20 rounded-b-2xl">
            <button 
              onClick={handleCopy} 
              className={buttonVariants({ variant: "outline", className: "gap-2" })}
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
            <button 
              onClick={handleSend} 
              className={buttonVariants({ variant: "default", className: "gap-2" })}
            >
              Send to Founder
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

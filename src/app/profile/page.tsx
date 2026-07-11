'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { auth } from '@/lib/firebase';

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [resumeText, setResumeText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/profile', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.resumeText) setResumeText(data.resumeText);
        }
      } catch (err) {
        console.error('Failed to fetch profile', err);
      }
    };
    fetchProfile();
  }, [user]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setMessage('');
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/extract-resume', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setResumeText(data.text);
        setMessage('Resume extracted successfully! Review and hit Save.');
      } else {
        setMessage('Failed to extract resume.');
      }
    } catch (err) {
      console.error('Extraction error:', err);
      setMessage('Error extracting resume.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ resumeText }),
      });
      
      if (res.ok) {
        setMessage('Resume saved successfully!');
      } else {
        setMessage('Failed to save resume.');
      }
    } catch {
      setMessage('Error saving resume.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    router.push('/');
  };

  if (loading || !user) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif text-foreground">Your Profile</h1>
        <button onClick={handleLogout} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Logout
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="text-xl font-medium mb-2">Resume Details</h2>
        <p className="text-secondary-foreground text-sm mb-6">
          Upload your PDF resume or paste its content below. This information will be used to generate highly customized cold DMs for the founders you select.
        </p>

        <div className="mb-4">
          <input 
            type="file" 
            accept="application/pdf"
            onChange={handleFileUpload}
            disabled={isExtracting}
            className="block w-full text-sm text-foreground
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-primary/10 file:text-primary
              hover:file:bg-primary/20
              cursor-pointer"
          />
          {isExtracting && <span className="text-sm text-muted-foreground mt-2 block">Extracting text from PDF...</span>}
        </div>

        <textarea
          className="w-full h-64 p-4 rounded-xl border border-border bg-background text-foreground mb-4 resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder="Extracted resume text will appear here..."
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
        />

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-green-500">{message}</span>
          <button 
            onClick={handleSave} 
            disabled={isSaving}
            className={buttonVariants({ variant: "default" })}
          >
            {isSaving ? 'Saving...' : 'Save Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { signInWithPopup, type User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import Image from 'next/image';
import { syncAuthenticatedUser } from '@/lib/sync-auth-user';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const signedInUser = useRef<User | null>(null);
  const loginInProgress = useRef(false);
  const router = useRouter();

  const handleGoogleLogin = async () => {
    if (loginInProgress.current) return;
    loginInProgress.current = true;
    setPending(true);
    setError('');
    try {
      if (!auth) throw new Error("Firebase auth not initialized");
      if (!signedInUser.current || auth.currentUser?.uid !== signedInUser.current.uid) {
        const result = await signInWithPopup(auth, googleProvider);
        signedInUser.current = result.user;
      }
      await syncAuthenticatedUser(signedInUser.current);

      router.push('/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login with Google.');
    } finally {
      loginInProgress.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-md p-8 bg-card border border-border rounded-2xl shadow-sm text-center">
        <h1 className="text-3xl font-serif text-foreground mb-2">Welcome Back</h1>
        <p className="text-secondary-foreground mb-8">Sign in to build your profile and create purposeful introductions</p>
        
        {error && <div role="alert" className="text-red-500 mb-4 text-sm">{error}</div>}

        <button 
          onClick={handleGoogleLogin} 
          disabled={pending}
          aria-busy={pending}
          className={buttonVariants({ variant: "default", className: "w-full flex items-center justify-center gap-2" })}
        >
          <Image src="https://www.svgrepo.com/show/475656/google-color.svg" width={20} height={20} className="w-5 h-5" alt="Google" />
          {pending ? 'Signing in…' : error ? 'Try again' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
}

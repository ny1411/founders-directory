'use client';

import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import Image from 'next/image';

export default function LoginPage() {
  const [error, setError] = useState('');
  const router = useRouter();

  const handleGoogleLogin = async () => {
    try {
      if (!auth) throw new Error("Firebase auth not initialized");
      const result = await signInWithPopup(auth, googleProvider);
      
      // We can also create/update the User in Prisma here, but doing it in a Server Action or API might be better.
      // For now, let's just create an API request to sync the user.
      await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebaseId: result.user.uid,
          email: result.user.email,
        }),
      });

      router.push('/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login with Google.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-md p-8 bg-card border border-border rounded-2xl shadow-sm text-center">
        <h1 className="text-3xl font-serif text-foreground mb-2">Welcome Back</h1>
        <p className="text-secondary-foreground mb-8">Sign in to access your custom cold DMs</p>
        
        {error && <div className="text-red-500 mb-4 text-sm">{error}</div>}

        <button 
          onClick={handleGoogleLogin} 
          className={buttonVariants({ variant: "default", className: "w-full flex items-center justify-center gap-2" })}
        >
          <Image src="https://www.svgrepo.com/show/475656/google-color.svg" width={20} height={20} className="w-5 h-5" alt="Google" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

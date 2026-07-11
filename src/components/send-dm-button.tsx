'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Send } from 'lucide-react';
import { ColdDmModal } from './cold-dm-modal';

interface SendDmButtonProps {
  founderId: string;
  founderName: string;
  companySlug: string;
}

export function SendDmButton({ founderId, founderName, companySlug }: SendDmButtonProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = async () => {
    if (loading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    try {
      // Check if user has resume by calling our profile API
      const token = await user.getIdToken();
      const res = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (!data.resumeText || data.resumeText.trim() === '') {
        router.push('/profile');
        return;
      }

      setIsModalOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
      <button 
        onClick={handleClick} 
        className={buttonVariants({ variant: "default", size: "sm", className: "w-full mt-4 flex items-center justify-center gap-2" })}
      >
        <Send className="w-4 h-4" />
        Send Custom Text
      </button>

      {isModalOpen && (
        <ColdDmModal 
          founderId={founderId} 
          founderName={founderName} 
          companySlug={companySlug} 
          onClose={() => setIsModalOpen(false)} 
        />
      )}
    </>
  );
}

'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { buttonVariants } from '@/components/ui/button';

export function SubmitCompanyButton() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="w-[140px] h-10 rounded-md bg-secondary animate-pulse ml-auto" />;
  }

  if (!user) {
    return null;
  }

  return (
    <Link href="/company/new" className={buttonVariants({ variant: "default", className: "ml-auto" })}>
      + Submit Company
    </Link>
  );
}

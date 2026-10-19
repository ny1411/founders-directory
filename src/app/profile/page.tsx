"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import {
  ProfileRequestError,
  readOnboardingResponse,
} from "@/lib/profile-load";
import { parseResumeData } from "@/lib/onboarding/resume";
import { BotIdProtection } from "@/components/bot-id-protection";

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const request = useCallback(
    async (method: "GET" | "POST", body?: Record<string, unknown>) => {
      if (!user) throw new Error("Sign in again to load your profile.");
      let token: string;
      try {
        token = await user.getIdToken();
      } catch {
        throw new ProfileRequestError(
          "Sign in again to load your profile.",
          "auth-error",
        );
      }
      const response = await fetch("/api/onboarding", {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      });
      return readOnboardingResponse(response);
    },
    [user],
  );

  const upload = useCallback(
    async (file: File) => {
      if (!user) throw new Error("Sign in again to upload a resume.");
      const token = await user.getIdToken();
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/extract-resume", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to import this resume.");
      return parseResumeData(payload.resume);
    },
    [user],
  );

  if (loading || !user)
    return (
      <p className="py-16 text-center" role="status">
        Loading…
      </p>
    );

  return (
    <>
      <BotIdProtection />
      <OnboardingForm
        key={user.uid}
        uid={user.uid}
        request={request}
        upload={upload}
        onExit={() => router.push("/")}
        onLogout={async () => {
          await auth?.signOut();
          router.replace("/login");
        }}
      />
    </>
  );
}

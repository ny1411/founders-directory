import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import type { MessageGenerationFailure } from "@/lib/onboarding/message-client";

interface ColdDmErrorPanelProps {
  failure: MessageGenerationFailure;
  message: string;
  recoveringSession: boolean;
  onRecoverSession: () => void;
}

export function ColdDmErrorPanel({
  failure,
  message,
  recoveringSession,
  onRecoverSession,
}: ColdDmErrorPanelProps) {
  if (failure === "auth") {
    return (
      <div role="alert" className="py-4 text-center">
        <h3 className="text-lg font-medium text-foreground">
          Your session has expired
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {message}
        </p>
        <button
          type="button"
          onClick={onRecoverSession}
          disabled={recoveringSession}
          className={buttonVariants({ variant: "default", className: "mt-5" })}
        >
          {recoveringSession ? "Opening sign in…" : "Sign in again"}
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className="break-words py-4 text-center text-red-500">
      {message}
    </div>
  );
}

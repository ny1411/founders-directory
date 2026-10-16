"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QUESTIONNAIRE_VERSION } from "@/lib/onboarding/questionnaires";
import type { OnboardingState } from "@/lib/onboarding/types";

export type OnboardingRequest = (
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) => Promise<OnboardingState>;

function combined(state: OnboardingState) {
  return { ...state.profile.answers, ...state.goal?.answers };
}

export function useOnboarding(request: OnboardingRequest) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading…");
  const [editRevision, setEditRevision] = useState(0);
  const current = useRef<OnboardingState | null>(null);
  const draft = useRef<Record<string, string>>({});
  const saved = useRef<Record<string, string>>({});
  const summaryDraft = useRef("");
  const summarySaved = useRef("");
  const inFlight = useRef<Promise<void> | null>(null);

  const apply = useCallback((next: OnboardingState) => {
    current.current = next;
    draft.current = combined(next);
    saved.current = { ...draft.current };
    summaryDraft.current = summarySaved.current = next.goal?.summary ?? "";
    setState(next);
    setAnswers(draft.current);
    setSummary(summaryDraft.current);
    setStatus("All changes saved");
    setError("");
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await request("GET"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load your profile.",
      );
    }
  }, [apply, request]);

  useEffect(() => {
    let active = true;
    void request("GET")
      .then((next) => {
        if (active) apply(next);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load your profile.",
          );
      });
    return () => {
      active = false;
    };
  }, [apply, request]);

  const context = useCallback(() => {
    const value = current.current;
    return {
      goalId: value?.goal?.id,
      profileVersion: value?.profile.version,
      goalRevision: value?.goal?.revision ?? 0,
      questionnaireVersion: QUESTIONNAIRE_VERSION,
    };
  }, []);

  const pending = useCallback(
    () =>
      Object.entries(draft.current).some(
        ([id, value]) => saved.current[id] !== value,
      ) || summaryDraft.current !== summarySaved.current,
    [],
  );

  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const operation = async () => {
      setStatus("Saving…");
      try {
        // Keep draining edits made while a previous network request was running.
        while (pending()) {
          const snapshot = { ...draft.current };
          const changed = Object.fromEntries(
            Object.entries(snapshot).filter(
              ([id, value]) => saved.current[id] !== value,
            ),
          );
          if (Object.keys(changed).length) {
            const next = await request("POST", {
              action: "save_answers",
              ...context(),
              answers: changed,
            });
            current.current = next;
            saved.current = snapshot;
            setState(next); // Never replace the user's newer draft with an older response.
            if (summaryDraft.current === summarySaved.current) {
              summaryDraft.current = summarySaved.current =
                next.goal?.summary ?? "";
              setSummary(summaryDraft.current);
            }
            continue;
          }
          const summarySnapshot = summaryDraft.current;
          const next = await request("POST", {
            action: "save_summary",
            ...context(),
            summary: summarySnapshot,
          });
          current.current = next;
          summarySaved.current = summarySnapshot;
          setState(next);
        }
        setStatus("All changes saved");
        setError("");
      } catch (reason) {
        setStatus("Changes not saved");
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to save your changes.",
        );
        throw reason;
      }
    };
    const promise = operation().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = promise;
    return promise;
  }, [context, pending, request]);

  useEffect(() => {
    if (!editRevision) return;
    const timeout = window.setTimeout(() => {
      void flush().catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [editRevision, flush]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pending() || inFlight.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const changeAnswer = (id: string, value: string) => {
    draft.current = { ...draft.current, [id]: value };
    setAnswers(draft.current);
    setStatus("Unsaved changes");
    setEditRevision((revision) => revision + 1);
  };

  const changeSummary = (value: string) => {
    summaryDraft.current = value;
    setSummary(value);
    setStatus("Unsaved changes");
    setEditRevision((revision) => revision + 1);
  };

  const action = async (body: Record<string, unknown>) => {
    await flush();
    const next = await request("POST", { ...context(), ...body });
    apply(next);
    return next;
  };

  return {
    state,
    answers,
    summary,
    status,
    error,
    load,
    apply,
    flush,
    context,
    action,
    changeAnswer,
    changeSummary,
  };
}

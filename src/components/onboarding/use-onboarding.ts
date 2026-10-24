"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QUESTIONNAIRE_VERSION } from "@/lib/onboarding/questionnaires";
import type { OnboardingState } from "@/lib/onboarding/types";
import { ProfileRequestError, type ProfileLoadState } from "@/lib/profile-load";

export type OnboardingRequest = (
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) => Promise<OnboardingState>;

import { readRecovery, writeRecovery, removeRecovery } from "@/lib/onboarding/recovery-storage";

const DEBOUNCE_MS = 1800;
const RECOVERY_VERSION = 1;
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;

interface RecoveryDraft {
  version: number;
  expiresAt: number;
  goalId: string;
  profileVersion: number;
  goalRevision: number;
  questionnaireVersion: number;
  answers: Record<string, string>;
  summary: string;
  summaryChanged: boolean;
}

function isTransient(reason: unknown) {
  if (reason instanceof ProfileRequestError)
    return reason.status === 408 || reason.status === 429 ||
      (reason.status !== undefined && reason.status >= 500);
  return reason instanceof TypeError;
}

function recoveryKey(uid: string) {
  return `onboarding-draft:v${RECOVERY_VERSION}:${uid}`;
}

function combined(state: OnboardingState) {
  return { ...state.profile.answers, ...state.goal?.answers };
}

export function useOnboarding(request: OnboardingRequest, uid: string) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading…");
  const [editRevision, setEditRevision] = useState(0);
  const [loadState, setLoadState] = useState<ProfileLoadState>("loading");
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const current = useRef<OnboardingState | null>(null);
  const draft = useRef<Record<string, string>>({});
  const saved = useRef<Record<string, string>>({});
  const summaryDraft = useRef("");
  const summarySaved = useRef("");
  const inFlight = useRef<Promise<void> | null>(null);

  const apply = useCallback((next: OnboardingState, clearRecovery = true) => {
    current.current = next;
    draft.current = combined(next);
    saved.current = { ...draft.current };
    summaryDraft.current = summarySaved.current = next.goal?.summary ?? "";
    setState(next);
    setAnswers(draft.current);
    setSummary(summaryDraft.current);
    setStatus("All changes saved");
    setError("");
    setLoadState("ready");
    setRecoveryAvailable(false);
    if (clearRecovery)
      try { removeRecovery(recoveryKey(uid)); } catch { /* Storage unavailable. */ }
  }, [uid]);

  const restore = useCallback((next: OnboardingState) => {
    let value: RecoveryDraft | null = null;
    try {
      const raw = readRecovery(uid, recoveryKey(uid));
      if (raw) value = JSON.parse(raw) as RecoveryDraft;
    } catch { /* Ignore malformed or unavailable storage. */ }
    apply(next, false);
    if (!value) return;
    if (value.version !== RECOVERY_VERSION ||
        value.expiresAt <= Date.now() ||
        value.questionnaireVersion !== QUESTIONNAIRE_VERSION ||
        !value.answers || typeof value.answers !== "object" ||
        Object.values(value.answers).some((answer) => typeof answer !== "string") ||
        typeof value.summary !== "string" ||
        typeof value.summaryChanged !== "boolean") {
      try { removeRecovery(recoveryKey(uid)); } catch { /* Storage unavailable. */ }
      return;
    }
    if (value.goalId !== next.goal?.id) return;
    if (value.profileVersion !== next.profile.version ||
        value.goalRevision !== (next.goal?.revision ?? 0)) {
      setRecoveryAvailable(true);
      setError("A newer profile was saved while you had local edits. Restore those edits to review and save them.");
      return;
    }
    draft.current = { ...draft.current, ...value.answers };
    if (value.summaryChanged) summaryDraft.current = value.summary;
    setAnswers(draft.current);
    setSummary(summaryDraft.current);
    if (Object.keys(value.answers).length || value.summaryChanged) {
      setStatus("Unsaved changes recovered");
      try { writeRecovery(uid, recoveryKey(uid), JSON.stringify(value)); } catch { /* Storage unavailable. */ }
    }
  }, [apply, uid]);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      restore(await request("GET"));
    } catch (reason) {
      setLoadState(
        reason instanceof ProfileRequestError ? reason.state : "backend-error",
      );
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load your profile.",
      );
    }
  }, [restore, request]);

  useEffect(() => {
    let active = true;
    void request("GET")
      .then((next) => {
        if (active) restore(next);
      })
      .catch((reason) => {
        if (active) {
          setLoadState(
            reason instanceof ProfileRequestError
              ? reason.state
              : "backend-error",
          );
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load your profile.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [restore, request]);

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

  const persistRecovery = useCallback(() => {
    try {
      const goal = current.current?.goal;
      if (!goal || !pending()) {
        removeRecovery(recoveryKey(uid));
        return;
      }
      const value: RecoveryDraft = {
        version: RECOVERY_VERSION,
        expiresAt: Date.now() + RECOVERY_TTL_MS,
        goalId: goal.id,
        profileVersion: current.current!.profile.version,
        goalRevision: goal.revision ?? 0,
        questionnaireVersion: QUESTIONNAIRE_VERSION,
        answers: Object.fromEntries(Object.entries(draft.current).filter(
          ([id, answer]) => saved.current[id] !== answer,
        )),
        summary: summaryDraft.current !== summarySaved.current ? summaryDraft.current : "",
        summaryChanged: summaryDraft.current !== summarySaved.current,
      };
      writeRecovery(uid, recoveryKey(uid), JSON.stringify(value));
    } catch { /* Storage unavailable. */ }
  }, [pending, uid]);

  const recoverDraft = useCallback(() => {
    try {
      const raw = readRecovery(uid, recoveryKey(uid));
      if (!raw) return;
      const value = JSON.parse(raw) as RecoveryDraft;
      if (value.version !== RECOVERY_VERSION || value.expiresAt <= Date.now() ||
          value.goalId !== current.current?.goal?.id ||
          value.questionnaireVersion !== QUESTIONNAIRE_VERSION ||
          !value.answers || typeof value.answers !== "object" ||
          Object.values(value.answers).some((answer) => typeof answer !== "string") ||
          typeof value.summary !== "string" ||
          typeof value.summaryChanged !== "boolean") return;
      draft.current = { ...draft.current, ...value.answers };
      if (value.summaryChanged) summaryDraft.current = value.summary;
      setAnswers(draft.current);
      setSummary(summaryDraft.current);
      setRecoveryAvailable(false);
      setError("");
      setStatus("Unsaved changes recovered");
      persistRecovery();
      setEditRevision((revision) => revision + 1);
    } catch { /* Storage unavailable. */ }
  }, [persistRecovery, uid]);

  const send = useCallback(async (body: Record<string, unknown>) => {
    for (let attempt = 0;; attempt++) {
      try {
        if (typeof performance !== "undefined")
          performance.mark("onboarding:autosave-request");
        return await request("POST", body);
      } catch (reason) {
        if (!isTransient(reason) || attempt >= MAX_RETRIES) throw reason;
        const delay = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 250;
        await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      }
    }
  }, [request]);

  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (!pending()) return Promise.resolve();
    const operation = async () => {
      setStatus("Saving…");
      setError("");
      try {
        // Keep draining edits made while a previous network request was running.
        while (pending()) {
          const changed = Object.fromEntries(
            Object.entries(draft.current).filter(
              ([id, value]) => saved.current[id] !== value,
            ),
          );
          if (Object.keys(changed).length) {
            const next = await send({
              action: "save_answers",
              ...context(),
              answers: changed,
            });
            current.current = next;
            saved.current = { ...saved.current, ...changed };
            setState(next); // Never replace the user's newer draft with an older response.
            if (summaryDraft.current === summarySaved.current) {
              summaryDraft.current = summarySaved.current =
                next.goal?.summary ?? "";
              setSummary(summaryDraft.current);
            }
            continue;
          }
          const summarySnapshot = summaryDraft.current;
          const next = await send({
            action: "save_summary",
            ...context(),
            summary: summarySnapshot,
          });
          current.current = next;
          summarySaved.current = summarySnapshot;
          setState(next);
          persistRecovery();
        }
        persistRecovery();
        setStatus("All changes saved");
        setError("");
      } catch (reason) {
        setStatus("Changes not saved");
        if (
          reason instanceof ProfileRequestError &&
          reason.state === "auth-error"
        )
          setLoadState("auth-error");
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to save your changes.",
        );
        persistRecovery();
        throw reason;
      }
    };
    const promise = operation().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = promise;
    return promise;
  }, [context, pending, persistRecovery, send]);

  useEffect(() => {
    if (!editRevision) return;
    const timeout = window.setTimeout(() => {
      void flush().catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [editRevision, flush]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush().catch(() => undefined);
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (pending() || inFlight.current) {
        persistRecovery();
        void flush().catch(() => undefined);
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", warn);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", warn);
    };
  }, [flush, pending, persistRecovery]);

  const changeAnswer = (id: string, value: string) => {
    draft.current = { ...draft.current, [id]: value };
    setAnswers(draft.current);
    setStatus(pending() ? "Unsaved changes" : "All changes saved");
    persistRecovery();
    setEditRevision((revision) => revision + 1);
  };

  const changeSummary = (value: string) => {
    summaryDraft.current = value;
    setSummary(value);
    setStatus(pending() ? "Unsaved changes" : "All changes saved");
    persistRecovery();
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
    loadState,
    answers,
    summary,
    status,
    error,
    recoveryAvailable,
    recoverDraft,
    load,
    apply,
    flush,
    context,
    action,
    changeAnswer,
    changeSummary,
  };
}

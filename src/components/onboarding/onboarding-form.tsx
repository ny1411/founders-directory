"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProfileLoadPanel } from "@/components/profile-load-panel";
import {
  getIntentQuestionnaire,
  sharedQuestionnaire,
} from "@/lib/onboarding/questionnaires";
import type {
  GoalStage,
  OnboardingState,
  OnboardingStep,
  UserIntent,
} from "@/lib/onboarding/types";
import {
  MAX_RESUME_BYTES,
  RESUME_SIZE_ERROR,
  RESUME_TYPE_ERROR,
} from "@/lib/resume-upload";
import { useOnboarding, type OnboardingRequest } from "./use-onboarding";

const intents: Array<{ value: UserIntent; label: string }> = [
  { value: "job", label: "Find a job or internship" },
  { value: "sell_services", label: "Sell services to businesses" },
  { value: "find_cofounder", label: "Find a cofounder" },
  { value: "raise_capital", label: "Raise capital" },
];
const stages: Array<{ value: GoalStage; label: string }> = [
  { value: "exploring", label: "Exploring" },
  { value: "actively_looking", label: "Actively looking" },
  {
    value: "specific_opportunity",
    label: "I have a specific person or opportunity in mind",
  },
  { value: "ready_to_talk", label: "Ready to start conversations" },
];

interface Props {
  request: OnboardingRequest;
  upload: (file: File) => Promise<OnboardingState>;
  onExit: () => void;
  onLogout: () => Promise<void>;
}

export function OnboardingForm({ request, upload, onExit, onLogout }: Props) {
  const form = useOnboarding(request);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [changingGoal, setChangingGoal] = useState(false);
  const [intent, setIntent] = useState<UserIntent | null>(null);
  const [stage, setStage] = useState<GoalStage | null>(null);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Unable to save your changes.",
      );
    } finally {
      setBusy(false);
    }
  };

  const nextStep = (step: OnboardingStep) =>
    run(async () => {
      await form.action({ action: "set_step", step });
      window.scrollTo({ top: 0 });
    });

  const uploadResume = (file?: File) =>
    run(async () => {
      if (!file) return;
      if (file.size > MAX_RESUME_BYTES) throw new Error(RESUME_SIZE_ERROR);
      if (
        file.type !== "application/pdf" ||
        file.size < 5 ||
        (await file.slice(0, 5).text()) !== "%PDF-"
      )
        throw new Error(RESUME_TYPE_ERROR);
      await form.flush();
      form.apply(await upload(file));
      setMessage(
        "Resume imported. Review the prefilled answers and add your own perspective.",
      );
    });

  if (!form.state || form.loadState === "auth-error")
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <ProfileLoadPanel
          state={form.loadState}
          isRecoveringSession={busy}
          onRetry={() => void form.load()}
          onRecoverSession={() => void run(onLogout)}
        />
      </div>
    );

  const state = form.state;
  const step = changingGoal ? "intent" : (state.goal?.currentStep ?? "intent");
  const number =
    step === "intent"
      ? 1
      : ["resume", "shared", "intent_questions"].includes(step)
        ? 2
        : 3;
  const section =
    step === "shared"
      ? sharedQuestionnaire
      : state.goal
        ? getIntentQuestionnaire(state.goal.type)
        : null;
  const error = message || form.error;

  return (
    <section
      className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6"
      aria-label="Profile onboarding"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Step {number} of 3
          </p>
          <h1 className="font-serif text-4xl tracking-tight">
            Build a profile with a purpose
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Tell us what you bring, what you care about, and who you want to
            meet.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await form.flush();
              await onLogout();
            })
          }
        >
          <LogOut data-icon="inline-start" /> Logout
        </Button>
      </header>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={number}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${(number / 3) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {busy ? "Working…" : form.status}
        </p>
        {state.goal && step !== "intent" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await form.flush();
                setChangingGoal(true);
                setIntent(state.goal!.type);
                setStage(state.goal!.stage);
              })
            }
          >
            Change goal
          </Button>
        ) : null}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 p-4 text-sm"
        >
          <p className="flex-1">{error}</p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => form.flush())}
          >
            Retry save
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => form.load())}
          >
            Reload saved answers
          </Button>
        </div>
      ) : null}

      {step === "intent" ? (
        <Card>
          <CardHeader>
            <CardTitle>What are you here to do?</CardTitle>
            <CardDescription>
              Choose a primary goal. Changing goals keeps your previous answers
              available.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label id="intent-label" className="text-sm font-medium">
                Primary goal
              </label>
              <Select
                items={intents}
                value={intent}
                onValueChange={(value) => setIntent(value as UserIntent | null)}
              >
                <SelectTrigger
                  aria-labelledby="intent-label"
                  className="w-full"
                  disabled={busy}
                >
                  <SelectValue placeholder="Choose your goal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {intents.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label id="stage-label" className="text-sm font-medium">
                Where are you today?
              </label>
              <Select
                items={stages}
                value={stage}
                onValueChange={(value) => setStage(value as GoalStage | null)}
              >
                <SelectTrigger
                  aria-labelledby="stage-label"
                  className="w-full"
                  disabled={busy}
                >
                  <SelectValue placeholder="Choose your stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {stages.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter className="justify-between gap-4">
            {changingGoal ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setChangingGoal(false)}
              >
                Cancel
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">
                You can change this later.
              </span>
            )}
            <Button
              disabled={busy || !intent || !stage}
              onClick={() =>
                void run(async () => {
                  await form.action({
                    action: "select_intent",
                    intent,
                    stage,
                    activeGoalId: state.account.activeGoalId,
                  });
                  setChangingGoal(false);
                })
              }
            >
              Continue <ArrowRight data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === "resume" ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {state.profile.hasResume
                ? "Replace your resume"
                : "Start with your resume"}
            </CardTitle>
            <CardDescription>
              We’ll prefill experience, projects, skills, and links. Your own
              edits take priority.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FileText className="size-8 text-muted-foreground" />
            <label htmlFor="resume-file" className="text-sm font-medium">
              Choose a PDF resume
            </label>
            <input
              id="resume-file"
              type="file"
              accept="application/pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void uploadResume(file);
              }}
            />
            <p className="text-sm text-muted-foreground">
              PDF only, up to 5 MiB. The original file is processed but not
              retained.
            </p>
          </CardContent>
          {state.profile.hasResume ? (
            <CardFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void nextStep("shared")}
              >
                Keep current resume
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      ) : null}

      {section && ["shared", "intent_questions"].includes(step) ? (
        <Card>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>
              {section.description} Starred questions are required; the rest can
              be filled in later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset disabled={busy} className="flex min-w-0 flex-col gap-7">
              {section.questions.map((question) => (
                <div key={question.id} className="flex flex-col gap-2">
                  <label htmlFor={question.id} className="text-sm font-medium">
                    {question.label}
                    {question.required ? " *" : ""}
                  </label>
                  <Textarea
                    id={question.id}
                    value={form.answers[question.id] ?? ""}
                    maxLength={question.maxLength}
                    required={question.required}
                    aria-required={question.required}
                    onChange={(event) =>
                      form.changeAnswer(question.id, event.target.value)
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {form.answers[question.id]?.length ?? 0}/
                    {question.maxLength}
                  </span>
                </div>
              ))}
            </fieldset>
          </CardContent>
          <CardFooter className="justify-between gap-4">
            {step === "intent_questions" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void nextStep("shared")}
              >
                <ArrowLeft data-icon="inline-start" /> Back
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => form.flush())}
              >
                Save answers
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                const missing = section.questions.find(
                  (question) =>
                    question.required && !form.answers[question.id]?.trim(),
                );
                if (missing) {
                  setMessage(`Answer the required question: ${missing.label}`);
                  document.getElementById(missing.id)?.focus();
                  return;
                }
                void nextStep(
                  step === "shared" ? "intent_questions" : "review",
                );
              }}
            >
              Continue <ArrowRight data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === "review" ? (
        <Card>
          <CardHeader>
            <CardTitle>How we understand you</CardTitle>
            <CardDescription>
              Check the summary before using it for introductions. Edits save
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="profile-summary"
              className="mb-2 block text-sm font-medium"
            >
              Profile summary
            </label>
            <Textarea
              id="profile-summary"
              className="min-h-44"
              disabled={busy}
              value={form.summary}
              maxLength={1200}
              onChange={(event) => form.changeSummary(event.target.value)}
            />
          </CardContent>
          <CardFooter className="justify-between gap-4">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void nextStep("intent_questions")}
            >
              <ArrowLeft data-icon="inline-start" /> Edit answers
            </Button>
            <Button
              disabled={busy || !form.summary.trim()}
              onClick={() =>
                void run(() => form.action({ action: "complete" }))
              }
            >
              <Check data-icon="inline-start" /> Confirm profile
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === "complete" ? (
        <Card>
          <CardHeader>
            <CardTitle>Your profile is ready</CardTitle>
            <CardDescription>
              {intents.find((item) => item.value === state.goal?.type)?.label}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="leading-7">{state.goal?.summary}</p>
          </CardContent>
          <CardFooter className="flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void nextStep("shared")}
            >
              Edit profile
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void nextStep("review")}
            >
              Edit summary
            </Button>
            {state.goal?.type === "job" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void nextStep("resume")}
              >
                Replace resume
              </Button>
            ) : null}
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await form.flush();
                  onExit();
                })
              }
            >
              Explore founders <ArrowRight data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FileText, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import { getIntentQuestionnaire, QUESTIONNAIRE_VERSION, sharedQuestionnaire } from "@/lib/onboarding/questionnaires";
import type { GoalStage, OnboardingState, QuestionnaireSection, UserIntent } from "@/lib/onboarding/types";
import { MAX_RESUME_BYTES, RESUME_SIZE_ERROR, RESUME_TYPE_ERROR } from "@/lib/resume-upload";

const intentOptions: Array<{ value: UserIntent; label: string; description: string }> = [
  { value: "job", label: "Find a job or internship", description: "Show what you can build and find the right startup role." },
  { value: "sell_services", label: "Sell services to businesses", description: "Define your offer, proof, and ideal customer." },
  { value: "find_cofounder", label: "Find a cofounder", description: "Match on ambition, complementary skills, and working style." },
  { value: "raise_capital", label: "Raise capital", description: "Explain your company, traction, and fundraising goal." },
];

const stageOptions: Array<{ value: GoalStage; label: string }> = [
  { value: "exploring", label: "Exploring" },
  { value: "actively_looking", label: "Actively looking" },
  { value: "specific_opportunity", label: "I have a specific person or opportunity in mind" },
  { value: "ready_to_talk", label: "Ready to start conversations" },
];

type LoadState = "loading" | "ready" | "auth-error" | "backend-error";

function buildSummary(state: OnboardingState, answers: Record<string, string>) {
  if (!state.goal) return "";
  const opening = answers.introduction || answers.about || "";
  const details: Record<UserIntent, string[]> = {
    job: [answers.desired_role, answers.relevant_experience, answers.best_shipped],
    sell_services: [answers.service, answers.service_audience, answers.problem_solved, answers.client_results],
    find_cofounder: [answers.building, answers.founder_strengths, answers.missing_capabilities, answers.market_insight],
    raise_capital: [answers.company, answers.fundraising_problem, answers.progress, answers.raise_amount],
  };
  return [opening, ...details[state.goal.type]].filter(Boolean).join(" ").slice(0, 1200);
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [state, setState] = useState<OnboardingState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [intent, setIntent] = useState<UserIntent | null>(null);
  const [stage, setStage] = useState<GoalStage | null>(null);
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const autosaveSequence = useRef(0);

  const request = useCallback(async (method: "GET" | "POST", body?: Record<string, unknown>) => {
    if (!user) throw new Error("Your session has expired.");
    const token = await user.getIdToken();
    const response = await fetch("/api/onboarding", {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to save your profile.");
    return payload as OnboardingState;
  }, [user]);

  const applyState = useCallback((next: OnboardingState) => {
    setState(next);
    const combined = { ...(next.profile?.answers ?? {}), ...(next.goal?.answers ?? {}) };
    setAnswers(combined);
    setSummary(next.goal?.summary || buildSummary(next, combined));
    setIntent(next.goal?.type ?? null);
    setStage(next.goal?.stage ?? null);
    setDirty(false);
  }, []);

  const loadOnboarding = useCallback(async () => {
    setLoadState("loading");
    try {
      applyState(await request("GET"));
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load onboarding.");
      setLoadState(error instanceof Error && /session|Unauthorized/i.test(error.message) ? "auth-error" : "backend-error");
    }
  }, [applyState, request]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    const timeout = window.setTimeout(() => { void loadOnboarding(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadOnboarding, user]);

  const saveAnswers = useCallback(async (showMessage = false) => {
    if (!state?.goal) return;
    const sequence = ++autosaveSequence.current;
    setSaving(true);
    try {
      const next = await request("POST", { action: "save_answers", questionnaireVersion: QUESTIONNAIRE_VERSION, answers });
      if (sequence === autosaveSequence.current) {
        setState(next);
        setDirty(false);
        if (showMessage) setMessage("Answers saved.");
      }
    } catch (error) {
      if (sequence === autosaveSequence.current) setMessage(error instanceof Error ? error.message : "Unable to save answers.");
      throw error;
    } finally {
      if (sequence === autosaveSequence.current) setSaving(false);
    }
  }, [answers, request, state?.goal]);

  useEffect(() => {
    if (!dirty || !state?.goal || !["shared", "intent_questions"].includes(state.goal.currentStep)) return;
    const timeout = window.setTimeout(() => { void saveAnswers().catch(() => undefined); }, 800);
    return () => window.clearTimeout(timeout);
  }, [dirty, saveAnswers, state?.goal]);

  const selectIntent = async () => {
    if (!intent || !stage) return setMessage("Choose what you want to accomplish and your current stage.");
    setSaving(true);
    setMessage("");
    try { applyState(await request("POST", { action: "select_intent", intent, stage })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to start onboarding."); }
    finally { setSaving(false); }
  };

  const uploadResume = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    if (file.size > MAX_RESUME_BYTES) return setMessage(RESUME_SIZE_ERROR);
    if (file.type !== "application/pdf" || file.size < 5 || await file.slice(0, 5).text() !== "%PDF-") return setMessage(RESUME_TYPE_ERROR);
    setExtracting(true);
    setMessage("");
    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/extract-resume", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to extract this resume.");
      await loadOnboarding();
      setMessage("Resume imported. Review the details we prefilled, then tell us what the document cannot.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to extract this resume."); }
    finally { setExtracting(false); }
  };

  const advanceQuestions = async (section: QuestionnaireSection, nextStep: "intent_questions" | "review") => {
    const missing = section.questions.filter((question) => question.required && !answers[question.id]?.trim());
    if (missing.length) {
      setMessage(`Answer the required question: ${missing[0].label}`);
      document.getElementById(missing[0].id)?.focus();
      return;
    }
    setMessage("");
    setSaving(true);
    try {
      await saveAnswers();
      applyState(await request("POST", { action: "set_step", step: nextStep }));
    } catch { /* saveAnswers reports the error */ }
    finally { setSaving(false); }
  };

  const goBack = async (step: "shared" | "intent_questions") => {
    setSaving(true);
    try { applyState(await request("POST", { action: "set_step", step })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to go back."); }
    finally { setSaving(false); }
  };

  const finish = async () => {
    setSaving(true);
    setMessage("");
    try {
      await request("POST", { action: "save_summary", summary });
      applyState(await request("POST", { action: "complete" }));
      setMessage("Your profile is ready.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to finish onboarding."); }
    finally { setSaving(false); }
  };

  const currentSection = state?.goal
    ? state.goal.currentStep === "shared" ? sharedQuestionnaire : getIntentQuestionnaire(state.goal.type)
    : null;

  if (authLoading || !user || loadState === "loading") {
    return <div className="mx-auto max-w-3xl py-20 text-center text-muted-foreground" role="status">Loading your onboarding…</div>;
  }

  if (loadState !== "ready" || !state) {
    return (
      <Card className="mx-auto mt-16 max-w-xl">
        <CardHeader><CardTitle>We couldn’t load your profile</CardTitle><CardDescription>{message}</CardDescription></CardHeader>
        <CardFooter className="justify-end"><Button onClick={() => void loadOnboarding()}>Try again</Button></CardFooter>
      </Card>
    );
  }

  const step = state.goal?.currentStep ?? "intent";
  const stepNumber = step === "intent" ? 1 : step === "resume" || step === "shared" || step === "intent_questions" ? 2 : 3;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Step {stepNumber} of 3</p>
          <h1 className="font-serif text-4xl tracking-tight">Build a profile with a purpose</h1>
          <p className="max-w-2xl text-muted-foreground">We’ll use your answers to find relevant people and write outreach that sounds like you.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void auth?.signOut().then(() => router.push("/"))}>
          <LogOut data-icon="inline-start" /> Logout
        </Button>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`Onboarding step ${stepNumber} of 3`} role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={stepNumber}>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(stepNumber / 3) * 100}%` }} />
      </div>

      {step === "intent" ? (
        <Card>
          <CardHeader><CardTitle>What are you here to do?</CardTitle><CardDescription>Choose one primary goal for now. The underlying profile can support additional goals later.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Primary goal
              <Select items={intentOptions} value={intent} onValueChange={(value) => setIntent(value as UserIntent)}>
                <SelectTrigger className="w-full" aria-label="Primary goal"><SelectValue placeholder="Choose your goal" /></SelectTrigger>
                <SelectContent><SelectGroup>{intentOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              {intent ? <span className="font-normal text-muted-foreground">{intentOptions.find((option) => option.value === intent)?.description}</span> : null}
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Where are you today?
              <Select items={stageOptions} value={stage} onValueChange={(value) => setStage(value as GoalStage)}>
                <SelectTrigger className="w-full" aria-label="Current stage"><SelectValue placeholder="Choose your stage" /></SelectTrigger>
                <SelectContent><SelectGroup>{stageOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </label>
          </CardContent>
          <CardFooter className="justify-between gap-4"><p className="text-sm text-muted-foreground">You can update this later.</p><Button disabled={saving} onClick={() => void selectIntent()}>Continue <ArrowRight data-icon="inline-end" /></Button></CardFooter>
        </Card>
      ) : null}

      {step === "resume" ? (
        <Card>
          <CardHeader><CardTitle>Start with your resume</CardTitle><CardDescription>We’ll use it to prefill the factual parts of your job profile. Your answers in the next step stay editable.</CardDescription></CardHeader>
          <CardContent>
            <label className="flex cursor-pointer flex-col items-center gap-4 rounded-xl border border-dashed border-border p-10 text-center hover:bg-muted/40">
              <FileText className="size-8 text-muted-foreground" />
              <span className="font-medium">{extracting ? "Extracting your resume…" : "Choose a PDF resume"}</span>
              <span className="text-sm text-muted-foreground">PDF only, up to 5 MiB. Five extraction attempts per 10 minutes.</span>
              <input className="sr-only" type="file" accept="application/pdf" disabled={extracting} onChange={(event) => void uploadResume(event)} />
            </label>
          </CardContent>
        </Card>
      ) : null}

      {currentSection && (step === "shared" || step === "intent_questions") ? (
        <Card>
          <CardHeader><CardTitle>{currentSection.title}</CardTitle><CardDescription>{currentSection.description} Answers save automatically.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-7">
            {currentSection.questions.map((question) => (
              <label key={question.id} htmlFor={question.id} className="flex flex-col gap-2 text-sm font-medium">
                <span>{question.label}{question.required ? <span className="text-destructive"> *</span> : null}</span>
                <Textarea id={question.id} value={answers[question.id] ?? ""} maxLength={question.maxLength} required={question.required} aria-required={question.required} onChange={(event) => { setAnswers((current) => ({ ...current, [question.id]: event.target.value })); setDirty(true); }} />
                <span className="text-xs font-normal text-muted-foreground">{answers[question.id]?.length ?? 0}/{question.maxLength}</span>
              </label>
            ))}
          </CardContent>
          <CardFooter className="justify-between gap-4">
            {step === "intent_questions" ? <Button variant="outline" disabled={saving} onClick={() => void goBack("shared")}><ArrowLeft data-icon="inline-start" /> Back</Button> : <span className="text-sm text-muted-foreground">{saving ? "Saving…" : dirty ? "Waiting to save…" : "Saved"}</span>}
            <Button disabled={saving} onClick={() => void advanceQuestions(currentSection, step === "shared" ? "intent_questions" : "review")}>Continue <ArrowRight data-icon="inline-end" /></Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === "review" ? (
        <Card>
          <CardHeader><CardTitle>How we understand you</CardTitle><CardDescription>Edit this summary until it is accurate. It will guide matching and outreach; your original answers remain unchanged.</CardDescription></CardHeader>
          <CardContent><label htmlFor="profile-summary" className="flex flex-col gap-2 text-sm font-medium">Profile summary<Textarea id="profile-summary" className="min-h-44" value={summary} maxLength={1200} onChange={(event) => setSummary(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">{summary.length}/1200</span></label></CardContent>
          <CardFooter className="justify-between gap-4"><Button variant="outline" disabled={saving} onClick={() => void goBack("intent_questions")}><ArrowLeft data-icon="inline-start" /> Back</Button><Button disabled={saving || !summary.trim()} onClick={() => void finish()}><Check data-icon="inline-start" /> Confirm profile</Button></CardFooter>
        </Card>
      ) : null}

      {step === "complete" ? (
        <Card>
          <CardHeader><CardTitle>Your profile is ready</CardTitle><CardDescription>Your goal and answers are saved separately, so this profile can support more purposes later.</CardDescription></CardHeader>
          <CardContent><p className="leading-7 text-foreground">{state.goal?.summary}</p></CardContent>
          <CardFooter className="justify-end"><Button onClick={() => router.push("/")}>Explore founders <ArrowRight data-icon="inline-end" /></Button></CardFooter>
        </Card>
      ) : null}

      {message ? <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">{message}</p> : null}
    </main>
  );
}

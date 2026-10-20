"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { parseResumeData } from "@/lib/onboarding/resume";
import type { ResumeData, ResumeItem } from "@/lib/onboarding/types";
import { ResumeContributions } from "./resume-contributions";

interface Props {
  initial: ResumeData | null;
  unavailable: boolean;
  onSave: (data: ResumeData) => Promise<void>;
  onCancel: () => void;
  onReload: () => Promise<void>;
}

const itemFields = ["name", "company", "role", "institution", "degree", "duration", "issuer", "date", "url"] as const;
const sectionFields: Record<string, readonly (typeof itemFields)[number][]> = {
  workExperience: ["company", "role", "duration", "url"],
  projects: ["name", "duration", "url"],
  education: ["institution", "degree", "duration", "url"],
  certificates: ["name", "issuer", "date", "url"],
};
const sections = [
  ["workExperience", "Work experience"], ["projects", "Projects"],
  ["education", "Education"], ["certificates", "Certificates"],
] as const;
const activityLabels: Record<string, string> = {
  hackathons: "Hackathons", "open-source": "Open source contributions",
  competitions: "Competitions", otherExtracurriculars: "Other activities",
};

/** Draft stays local to this editor until the user explicitly saves it. */
export function ResumeEditor({ initial, unavailable, onSave, onCancel, onReload }: Props) {
  const [draft, setDraft] = useState<ResumeData>(() => structuredClone(initial ?? {}));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: ResumeData) => { setDraft(next); setDirty(true); setError(""); };
  const field = (label: string, value: string, update: (value: string) => void, multiline = false) => (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span>{label}</span>
      {multiline
        ? <Textarea value={value} maxLength={10_000} onChange={(event) => update(event.target.value)} />
        : <Input value={value} maxLength={10_000} onChange={(event) => update(event.target.value)} />}
    </label>
  );
  const itemSection = (key: string, label: string, items: ResumeItem[], update: (items: ResumeItem[]) => void) => (
    <section key={key} className="flex min-w-0 flex-col gap-4" aria-label={label}>
      <h3 className="font-medium">{label}</h3>
      {items.map((item, index) => (
        <fieldset key={index} className="grid min-w-0 gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm">{label} {index + 1}</legend>
          {Array.from(new Set([...(Object.hasOwn(sectionFields, key) ? sectionFields[key] : ["name", "duration", "url"]), ...itemFields.filter((name) => Boolean(item[name]))])).map((name) => (
            <div key={name} className="min-w-0">
              {field(name === "url" ? "URL" : name[0].toUpperCase() + name.slice(1), String(item[name] ?? ""), (value) => {
                const next = [...items]; next[index] = { ...item, [name]: value }; update(next);
              })}
            </div>
          ))}
          <div className="min-w-0 sm:col-span-2">
            {field("Description (one point per line)", item.description?.join("\n") ?? "", (value) => {
              const next = [...items]; next[index] = { ...item, description: value.split("\n") }; update(next);
            }, true)}
          </div>
          <Button type="button" variant="outline" onClick={() => update(items.filter((_, i) => i !== index))}>Remove {label.toLowerCase()} {index + 1}</Button>
        </fieldset>
      ))}
      <Button type="button" variant="outline" className="self-start" disabled={items.length >= 100} onClick={() => update([...items, { name: "" }])}>Add {label.toLowerCase()}</Button>
    </section>
  );
  const save = async () => {
    setBusy(true); setError("");
    try {
      const parsed = parseResumeData(draft);
      await onSave(parsed);
      setDirty(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your resume. Your edits are still here.");
    } finally { setBusy(false); }
  };

  return (
    <Card aria-label="Resume editor">
      <CardHeader>
        <CardTitle><h2>Review resume details</h2></CardTitle>
        <CardDescription>Correct the extracted information before saving. These private details are used for your introduction messages. Changes are saved only when you choose Save resume.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        {unavailable ? <p role="status">Your previous resume details could not be read. Enter corrected details here or cancel and upload a new PDF.</p> : null}
        {error ? <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{error} Your edits have been kept. Correct the field and try again.</p> : null}
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-7">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(["name", "location", "email", "phone"] as const).map((key) => <div key={key}>{field(key[0].toUpperCase() + key.slice(1), draft[key] ?? "", (value) => change({ ...draft, [key]: value }))}</div>)}
          </div>
          {field("Skills (one per line)", draft.skills?.join("\n") ?? "", (value) => change({ ...draft, skills: value.split("\n") }), true)}
          <section aria-label="Resume links" className="flex min-w-0 flex-col gap-3">
            <h3 className="font-medium">Links</h3>
            {(draft.links ?? []).map((link, index) => <fieldset key={index} className="grid min-w-0 gap-3 rounded-lg border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm">Link {index + 1}</legend>
              {field("Label", link.label ?? "", (value) => { const links = [...(draft.links ?? [])]; links[index] = { ...link, label: value }; change({ ...draft, links }); })}
              {field("Link URL", link.url, (value) => { const links = [...(draft.links ?? [])]; links[index] = { ...link, url: value }; change({ ...draft, links }); })}
              <Button type="button" variant="outline" onClick={() => change({ ...draft, links: draft.links?.filter((_, i) => i !== index) })}>Remove link {index + 1}</Button>
            </fieldset>)}
            <Button type="button" variant="outline" className="self-start" disabled={(draft.links?.length ?? 0) >= 100} onClick={() => change({ ...draft, links: [...(draft.links ?? []), { url: "" }] })}>Add link</Button>
          </section>
          {sections.map(([key, label]) => itemSection(key, label, draft[key] ?? [], (items) => change({ ...draft, [key]: items })))}
          {Array.from(new Set([...Object.keys(activityLabels), ...Object.keys(draft.extracurriculars ?? {})])).map((key) => itemSection(key, (Object.hasOwn(activityLabels, key) ? activityLabels[key] : key), draft.extracurriculars?.[key] ?? [], (items) => change({ ...draft, extracurriculars: { ...draft.extracurriculars, [key]: items } })))}
        </fieldset>
        <ResumeContributions extracurriculars={draft.extracurriculars} />
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving resume…" : "Save resume"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel resume changes</Button>
        {error ? <Button type="button" variant="ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await onReload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to reload your resume."); }
          finally { setBusy(false); }
        }}>Reload saved resume (discard edits)</Button> : null}
      </CardFooter>
    </Card>
  );
}

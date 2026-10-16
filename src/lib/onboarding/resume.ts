import { getQuestionMap } from "./questionnaires";
import type { ResumeData, ResumeItem } from "./types";

export const RESUME_SCHEMA_VERSION = 2;
export const RESUME_MODEL = "gemini-3.5-flash";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid resume object");
  return value as Record<string, unknown>;
}

function string(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 10_000)
    throw new Error("Invalid resume text");
  return value.trim() || undefined;
}

function list(value: unknown): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Invalid resume list");
  return value;
}

export function safeResumeUrl(value: unknown) {
  const text = string(value);
  if (!text) return undefined;
  const url = new URL(text);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid resume URL");
  return url.href;
}

function descriptions(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [string(value)!].filter(Boolean);
  // Older extraction prompts returned bullet objects. Normalize these once at import.
  return list(value).flatMap((item) =>
    typeof item === "string"
      ? [string(item)!].filter(Boolean)
      : Object.values(record(item))
          .map((point) => string(point)!)
          .filter(Boolean),
  );
}

function items(value: unknown): ResumeItem[] {
  return list(value).map((item) => {
    const input = record(item);
    const result: ResumeItem = {};
    for (const key of [
      "name",
      "company",
      "role",
      "institution",
      "degree",
      "duration",
      "issuer",
      "date",
    ]) {
      const text = string(input[key]);
      if (text) result[key] = text;
    }
    if (input.description != null)
      result.description = descriptions(input.description);
    const url = safeResumeUrl(input.url);
    if (url) result.url = url;
    if (!Object.keys(result).length) throw new Error("Empty resume item");
    return result;
  });
}

export function parseResumeData(value: unknown): ResumeData {
  const input = record(value);
  if (JSON.stringify(input).length > 200_000)
    throw new Error("Resume extraction is too large");
  const result: ResumeData = {};
  for (const key of ["name", "location", "email", "phone"]) {
    const text = string(input[key]);
    if (text) result[key] = text;
  }
  if (input.skills != null)
    result.skills = list(input.skills)
      .map((skill) => string(skill)!)
      .filter(Boolean);
  if (input.links != null) {
    result.links = list(input.links).map((link) => {
      const entry = record(link);
      const url = safeResumeUrl(entry.url);
      if (!url) throw new Error("Resume link requires a URL");
      const label = string(entry.label);
      return label ? { label, url } : { url };
    });
  }
  for (const key of [
    "workExperience",
    "projects",
    "education",
    "certificates",
  ] as const) {
    if (input[key] != null) result[key] = items(input[key]);
  }
  if (input.extracurriculars != null) {
    const entries = record(input.extracurriculars);
    if (Object.keys(entries).length > 20)
      throw new Error("Too many resume sections");
    result.extracurriculars = Object.fromEntries(
      Object.entries(entries).map(([key, value]) => [key, items(value)]),
    );
  }
  if (
    !result.name &&
    !result.skills?.length &&
    !result.workExperience?.length &&
    !result.projects?.length &&
    !result.education?.length
  ) {
    throw new Error("No usable resume information found");
  }
  return result;
}

function formatItems(value: ResumeItem[] = []) {
  return value
    .map((item) =>
      [
        item.company || item.name || item.institution,
        item.role || item.degree,
        item.duration,
        ...(item.description ?? []),
        item.url,
      ]
        .filter(Boolean)
        .join(" — "),
    )
    .join("\n\n");
}

export function resumePrefill(data: ResumeData) {
  const questions = getQuestionMap("job");
  const profile: Record<string, string> = {};
  const goal: Record<string, string> = {};
  const candidates: Record<string, string | undefined> = {
    about: [
      data.name,
      formatItems(data.workExperience),
      formatItems(data.projects),
    ]
      .filter(Boolean)
      .join("\n\n"),
    location_timezone: data.location,
    strengths: data.skills?.join(", "),
    links: data.links?.map((link) => link.url).join("\n"),
    relevant_experience: formatItems(data.workExperience),
    representative_projects: formatItems(data.projects),
    confident_tools: data.skills?.join(", "),
  };
  for (const [id, value] of Object.entries(candidates)) {
    const question = questions.get(id)!;
    if (!value) continue;
    // URLs are never cut mid-address; keep only whole URLs within the answer limit.
    const answer =
      id === "links"
        ? value
            .split("\n")
            .filter(
              (url, index, urls) =>
                urls.slice(0, index + 1).join("\n").length <=
                question.maxLength,
            )
            .join("\n")
        : value.slice(0, question.maxLength);
    (question.scope === "profile" ? profile : goal)[id] = answer;
  }
  return { profile, goal };
}

export function profilePrefillFromResume(value: Record<string, unknown>) {
  return {
    hasResume: true,
    answers: resumePrefill(parseResumeData(value)).profile,
  };
}

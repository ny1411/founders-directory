import type { ReusableProfile } from "./types";

export function parseResumeData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid resume data");
  return value as Record<string, unknown>;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(stringify).filter(Boolean).join(" — ");
  return "";
}

export function profilePrefillFromResume(data: Record<string, unknown>): Partial<ReusableProfile> {
  const work = stringify(data.workExperience);
  const projects = stringify(data.projects);
  const skills = stringify(data.skills);
  const links = stringify(data.links);
  return {
    hasResume: true,
    answers: {
      ...(data.location ? { location_timezone: stringify(data.location) } : {}),
      ...(skills ? { strengths: skills } : {}),
      ...(links ? { links } : {}),
      ...(work || projects ? { about: [work, projects].filter(Boolean).join("\n\n").slice(0, 1200) } : {}),
    },
  };
}

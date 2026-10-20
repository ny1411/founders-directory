import React from "react";
import type { ResumeData } from "@/lib/onboarding/types";

const sectionLabels: Record<string, string> = {
  hackathons: "Hackathons",
  "open-source": "Open source contributions",
  openSource: "Open source contributions",
  openSourceContributions: "Open source contributions",
  competitions: "Competitions",
  otherExtracurriculars: "Other activities",
};

function sectionLabel(key: string) {
  return (
    (Object.hasOwn(sectionLabels, key) ? sectionLabels[key] : undefined) ||
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

function safeLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function ResumeContributions({
  extracurriculars,
}: {
  extracurriculars?: ResumeData["extracurriculars"] | null;
}) {
  const sections = Object.entries(extracurriculars ?? {}).flatMap(
    ([key, entries]) => {
      const items = entries.filter(
        (item) =>
          item.name?.trim() ||
          item.duration?.trim() ||
          item.description?.some((point) => point.trim()) ||
          safeLink(item.url),
      );
      return items.length ? [{ key, items }] : [];
    },
  );
  if (!sections.length) return null;

  return (
    <section aria-label="Contributions and activities" className="space-y-4">
      <h3 className="text-base font-semibold">Contributions and activities</h3>
      {sections.map(({ key, items }) => (
        <section key={key} aria-label={sectionLabel(key)} className="space-y-2">
          <h4 className="text-sm font-medium">{sectionLabel(key)}</h4>
          <ul className="space-y-3">
            {items.map((item, index) => {
              const url = safeLink(item.url);
              const description = item.description?.filter((point) => point.trim());
              return (
                <li key={index} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm [overflow-wrap:anywhere]">
                  {item.name?.trim() ? <p className="font-medium">{item.name}</p> : null}
                  {item.duration?.trim() ? (
                    <p className="text-muted-foreground">{item.duration}</p>
                  ) : null}
                  {description?.length ? (
                    <ul className="list-disc space-y-1 pl-4">
                      {description.map((point, pointIndex) => <li key={pointIndex}>{point}</li>)}
                    </ul>
                  ) : null}
                  {url ? (
                    <a className="inline-block rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2" href={url} target="_blank" rel="noopener noreferrer">
                      View {item.name?.trim() || "activity"}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}

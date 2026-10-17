import type { OnboardingState, UserIntent } from "./types";

function phrase(value: string | undefined, max = 180) {
  const text =
    value
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "") || "";
  if (text.length <= max) return text;
  const end = text.lastIndexOf(" ", max - 1);
  return `${text.slice(0, end > 0 ? end : max - 1)}…`;
}

export function buildProfileSummary(state: OnboardingState): string {
  if (!state.goal) return "";
  const a = { ...state.profile.answers, ...state.goal.answers };
  const lead = phrase(a.introduction || a.about, 180);
  const sentences: Record<UserIntent, string[]> = {
    job: [
      a.desired_role && `Seeking: ${phrase(a.desired_role, 100)}`,
      a.strengths && `Strengths: ${phrase(a.strengths, 120)}`,
      a.best_shipped && `Built or shipped: ${phrase(a.best_shipped)}`,
    ],
    sell_services: [
      a.service && `Service: ${phrase(a.service)}`,
      a.service_audience && `For: ${phrase(a.service_audience, 120)}`,
      a.problem_solved && `Problem solved: ${phrase(a.problem_solved)}`,
      a.client_results && `Evidence: ${phrase(a.client_results)}`,
    ],
    find_cofounder: [
      a.building && `Building: ${phrase(a.building)}`,
      a.founder_strengths && `Brings: ${phrase(a.founder_strengths, 120)}`,
      a.missing_capabilities &&
        `Seeking a partner with: ${phrase(a.missing_capabilities, 120)}`,
      a.commitment && `Commitment: ${phrase(a.commitment, 100)}`,
    ],
    raise_capital: [
      a.company && `Raising for: ${phrase(a.company, 100)}`,
      a.fundraising_problem && `Problem: ${phrase(a.fundraising_problem)}`,
      a.raise_amount && `Raise: ${phrase(a.raise_amount, 100)}`,
      a.proof_metric && `Traction: ${phrase(a.proof_metric)}`,
      a.hundred_k_unlock && `Capital unlocks: ${phrase(a.hundred_k_unlock)}`,
    ],
  };
  return [lead, ...sentences[state.goal.type]]
    .filter(Boolean)
    .map((sentence) => `${sentence}.`)
    .join(" ")
    .slice(0, 1200);
}

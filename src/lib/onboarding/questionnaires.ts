import type { QuestionnaireQuestion, QuestionnaireSection, UserIntent } from "./types";

export const QUESTIONNAIRE_VERSION = 1;

const text = (
  id: string,
  label: string,
  scope: "profile" | "goal" = "goal",
  required = false,
  maxLength = 2000,
  usage: QuestionnaireQuestion["usage"] = ["matching", "outreach"],
): QuestionnaireQuestion => ({ id, label, input: "textarea", required, maxLength, scope, usage });

const sharedQuestions: QuestionnaireQuestion[] = [
  text("about", "Tell us a little about yourself.", "profile", true, 1200, ["display", "matching", "outreach"]),
  text("strengths", "What are you especially good at?", "profile", true, 1200, ["display", "matching", "outreach"]),
  text("problems_enjoyed", "What kinds of problems do you enjoy solving?", "profile", false, 1200),
  text("current_interests", "What are you currently working on or interested in?", "profile", false, 1200),
  text("location_timezone", "Where are you based, and what time zone do you work in?", "profile", true, 300, ["display", "matching"]),
  { id: "links", label: "Add relevant links, one URL per line: personal website, LinkedIn, X, GitHub, portfolio, or other.", input: "textarea", maxLength: 1500, scope: "profile", usage: ["display", "outreach"] },
  text("introduction", "How would you like to be introduced to other people?", "profile", false, 800, ["display", "outreach"]),
  text("message_voice", "How should messages written on your behalf sound?", "profile", false, 800, ["outreach"]),
];

const intentQuestions: Record<UserIntent, QuestionnaireQuestion[]> = {
  job: [
    text("desired_role", "What type of role are you looking for?", "goal", true),
    text("functions", "Which functions interest you (engineering, design, product, sales, marketing, operations, finance, etc.)?", "goal", true),
    text("target_level", "What level are you targeting?"),
    text("company_preferences", "What kinds of companies interest you?"),
    text("industry_interests", "Which industries or problem spaces interest you?"),
    text("relevant_experience", "Describe your most relevant previous experience.", "goal", true),
    text("personal_contribution", "What did you personally contribute?"),
    text("work_outcomes", "What changed as a result of your work?"),
    text("representative_projects", "Which projects best represent your abilities?"),
    text("confident_tools", "Which technologies, tools, or methods do you use confidently?"),
    text("currently_learning", "What are you currently learning?"),
    text("work_environment", "What type of work environment helps you perform well?"),
    text("job_constraints", "Are there constraints around location, remote work, compensation, visa, or start date?"),
    text("job_rejection_reason", "What would make you reject an otherwise good opportunity?"),
    text("best_shipped", "What’s the best thing you’ve built or shipped?", "goal", true),
    text("self_directed_college", "What did you do more in college that nobody required, like a club, hackathon, or side gig?"),
    text("weakest_skill", "What’s your weakest skill right now, and what have you done about it this month?"),
    text("startup_motivation", "Why work for a startup with a real chance of failing, instead of a stable company?", "goal", true),
    text("ten_x_problem", "What problem have you solved that made you 10× more valuable to the team?"),
  ],
  sell_services: [
    text("service", "What service do you provide?", "goal", true),
    text("service_audience", "Who is the service for?", "goal", true),
    text("ideal_business", "What type of business benefits most from it?"),
    text("problem_solved", "What problem do you help them solve?", "goal", true),
    text("problem_cost", "What usually happens when this problem is not solved?"),
    text("service_approach", "What is your approach to solving it?"),
    text("client_results", "What results have you produced for previous clients or projects?"),
    text("case_study", "Describe your strongest case study."),
    text("proof", "What proof can you share?"),
    text("differentiation", "What makes your service different from common alternatives?"),
    text("scope_timeline", "What is the typical scope or timeline?"),
    text("pricing", "What is your pricing model or starting price?"),
    text("prospect_signals", "What signals suggest a company is a good prospect?"),
    text("bad_fit_companies", "Which types of companies are not a good fit?"),
    text("decision_maker", "Which decision-maker do you want to reach?"),
    text("first_conversation", "What should the first conversation accomplish?"),
    text("tolerated_expensive_problem", "What expensive problem do you solve that founders have learned to tolerate?", "goal", true),
    text("bad_fit_client", "Which client is a bad fit for you, and why do you turn them away?"),
    text("monthly_loss", "What does a company like mine lose each month without your service? Give me a number.", "goal", true),
  ],
  find_cofounder: [
    text("building", "What are you building or hoping to build?", "goal", true),
    text("important_problem", "What problem do you care deeply about?", "goal", true),
    text("problem_motivation", "Why do you want to work on this problem?"),
    text("venture_stage", "What is the current stage of the idea or company?"),
    text("validation", "What have you already done to validate it?"),
    text("hardest_builder_problem", "What is the hardest problem you have solved as a founder or builder?"),
    text("founder_strengths", "What are your strongest capabilities?", "goal", true),
    text("missing_capabilities", "Which capabilities are missing from the current team?", "goal", true),
    text("slow_progress_motivation", "What motivates you when progress is slow?"),
    text("decision_style", "How do you make important decisions?"),
    text("disagreement_style", "How do you handle disagreement?"),
    text("working_relationship", "What kind of working relationship do you prefer?"),
    text("commitment", "How much time can you commit?"),
    text("cofounder_commitment", "Are you looking for a full-time or part-time cofounder?"),
    text("own_role", "What role do you expect to play?"),
    text("other_role", "What role should the other founder play?"),
    text("ownership_expectations", "What are your expectations around ownership and commitment?"),
    text("non_negotiables", "What are your non-negotiables?"),
    text("cofounder_rejection_reason", "What would make you decide not to work with someone?"),
    text("worst_disagreement", "Describe the worst disagreement you’ve had with a partner. Who was right?", "goal", true),
    text("avoided_business_area", "Which part of the business will you never touch?"),
    text("why_not_alone", "Why haven’t you started this idea alone already?", "goal", true),
    text("market_insight", "What do you understand about this market that most outsiders get completely wrong?", "goal", true),
  ],
  raise_capital: [
    text("company", "What company or project are you raising for?", "goal", true),
    text("fundraising_problem", "What problem are you solving?", "goal", true),
    text("customer", "Who experiences this problem?"),
    text("solution", "What is your solution?", "goal", true),
    text("timing", "Why is this the right time to build it?"),
    text("progress", "What progress have you made?"),
    text("demand_evidence", "What evidence of demand do you have?"),
    text("important_metrics", "What are your most important metrics?"),
    text("business_model", "What is your business model?"),
    text("market_size", "How large could this become?"),
    text("competition", "Who are the alternatives or competitors?"),
    text("fundraising_differentiation", "What makes your approach different?"),
    text("founding_team", "Who is on the founding team?"),
    text("raise_amount", "How much are you raising?", "goal", true),
    text("use_of_funds", "What will the capital be used for?"),
    text("funding_milestones", "What milestones will the funding help you reach?"),
    text("investor_type", "What type of investor are you looking for?"),
    text("investor_preferences", "Which sectors, geographies, check sizes, or investor characteristics are relevant?"),
    text("fundraising_conversation", "What kind of introduction or conversation are you seeking?"),
    text("hundred_x_evidence", "What evidence suggests your company could become 100× bigger than it is today?", "goal", true),
    text("founder_commitment", "How much of your own money, time, or career have you already put in?"),
    text("hundred_k_unlock", "If I invested $100K tomorrow, what would that money unlock next Monday?", "goal", true),
    text("capital_efficiency", "What have you proven with the least amount of money, time, or resources?"),
    text("proof_metric", "What is the one number that proves this is working, and where is it today?", "goal", true),
  ],
};

export const sharedQuestionnaire: QuestionnaireSection = {
  id: "shared",
  title: "The person behind the goal",
  description: "Give people enough context to understand what you care about and how you work.",
  questions: sharedQuestions,
};

export function getIntentQuestionnaire(intent: UserIntent): QuestionnaireSection {
  const titles: Record<UserIntent, [string, string]> = {
    job: ["Your next role", "Help us understand your experience, judgment, and appetite for startup work."],
    sell_services: ["Your service", "Define the expensive problem, ideal client, proof, and commercial outcome."],
    find_cofounder: ["Your cofounder fit", "Describe the venture, the partnership you want, and how you behave under pressure."],
    raise_capital: ["Your raise", "Explain the company, evidence, ambition, and what new capital unlocks."],
  };
  return { id: intent, title: titles[intent][0], description: titles[intent][1], questions: intentQuestions[intent] };
}

export function getQuestionMap(intent: UserIntent) {
  return new Map([...sharedQuestions, ...intentQuestions[intent]].map((question) => [question.id, question]));
}

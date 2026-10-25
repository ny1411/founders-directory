# What issue #41 means

Issue [#41](https://github.com/ny1411/founders-directory/issues/41) is the work to
notice a traffic or cost spike early, understand its cause, and respond before
the site is paused again. It follows the October incident where unusual homepage
traffic exhausted the Vercel CPU allowance. CPU here means the computing work
Vercel performs to serve requests; pageviews and visitor counts alone do not tell
us how much work happened.

## The five parts

| Part | What it gives you | What still needs proof |
| --- | --- | --- |
| Alerts | A warning when usage, requests, errors, or blocked traffic rise | Which alerts your account supports, where they go, and a successful test delivery |
| Dashboards | Views showing the busy routes, errors, cache behavior, and Firewall activity | Saved Production and Preview views that you can find and interpret |
| Application records | Safe counts, durations, successes, failures, and quota decisions | Records actually arriving from the deployed app |
| Response instructions | A sequence for investigating, containing traffic, and recovering | A rehearsal against a safe Preview environment |
| Follow-up monitoring | Checks that recovery holds and real users can use the site | An assigned 24-hour watch with recorded observations |

The starting CPU warning levels are 50%, 75%, and 90% of the monthly allowance.
Traffic signals include five times the recent hourly baseline, a single route
dominating requests, many more pageviews than visitors, or a sudden drop in cache
hits. These are investigation prompts to tune against normal traffic. They are
not proof that a visitor is malicious, and are not configured alerts yet.

A cache hit means Vercel can reuse a response; an uncached request may run the
app and read the database. The Firewall can reject requests before they reach
the app. An app-generated `429` means the app rejected an over-quota request,
which still reached a Function. This difference matters when diagnosing costs.

## What “primary” and “backup operator” mean

The primary operator is simply the person who reads a warning and takes action.
For this project, the current default is its owner, `ny1411`. It is not a new
job title or a service you need to buy.

A backup is another trusted person who can help if the owner is unavailable.
If you run the project alone, leave backup coverage unassigned and document
that limitation. The original issue asks for a two-person rehearsal; that item
will remain pending, but it need not stop useful monitoring work now.

The alert destination means where you want warnings delivered, such as a
monitored email address or another destination your account supports. No address
has been assumed and no messages have been sent. First inspect the supported
options, then choose one you actually check and test its delivery deliberately.

## What exists now and what it costs

The repository already instruments important API operations and restricts
telemetry fields. A remaining bug silently discarded measurements when no
paid metrics emitter was installed. The follow-up fixes that default by writing
validated JSON metric records to the normal Function logs. They contain finite
metric names, numeric values, and bounded route/outcome/provider tags. Private
resumes, messages, contact details, tokens, and user IDs are excluded.

On 25 October 2026, Vercel confirmed **Observability Plus is not enabled** for
team `ny1411`. That response does not establish your billing plan or which other
alerts are available. No paid upgrade is required by the code change. Normal
Vercel logging usage and retention limits still apply. Logs are measurements
available for inspection; they do not automatically watch the site or email you.

The verified project is **`foundersdirectory`**, ID
`prj_oxUZTfhN9aAIwtcABk8dcX00nFvt`. Its repository is spelled
`founders-directory`. The technical [incident runbook](vercel-usage-incident.md)
uses the verified project target.

## What remains before #41 is complete

1. Inspect the account's supported alerts, Usage views, and retention limits.
2. Choose a warning destination and prove a test notification arrives.
3. Verify a deployed request produces the expected safe records, and save the
   available Production/Preview views.
4. Rehearse a small Preview incident without paid provider calls, production
   load testing, or changes that block real users.
5. Record who responds, any backup gap, the rehearsal results, and the 24-hour
   recovery watch.

Passing repository tests establishes the logging/privacy behavior. It does not
establish live alert delivery, continuous monitoring, edge enforcement, or
incident readiness by itself. Issue #40 covers Firewall controls, while #47
coordinates deploying and verifying the broader protection setup.

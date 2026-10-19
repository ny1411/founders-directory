import { GoogleGenAI } from '@google/genai';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createResumeExtractionHandler } from '@/lib/resume-extraction-handler';
import { reserveResumeExtractionAttempt } from '@/lib/resume-extraction-usage';
import { OnboardingStore } from '@/lib/onboarding/store';
import { createBotProtectedPost } from '@/lib/bot-verification';
import { instrumentApiRoute } from '@/lib/observability-runtime';

export const runtime = 'nodejs';
const onboardingStore = new OnboardingStore(adminDb);

const extractResume = createResumeExtractionHandler({
  verifyToken: (token) => adminAuth.verifyIdToken(token, true),
  authorizeUpload: async (uid) => (await onboardingStore.load(uid)).goal?.type === 'job',
  reserveAttempt: (uid) => reserveResumeExtractionAttempt(adminDb, uid),
  extract: async (buffer) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
You are an expert ATS (Applicant Tracking System) parser.
Extract the following resume details into a structured JSON format. 
Make sure to extract all hyperlinks (especially for GitHub, LinkedIn, portfolios, etc.) found in the text.
Only output valid JSON. Do not include markdown code blocks. 
The projects, experience, hackathons, etc have links embedded in texts, make sure to format them right in those respective sections.
If date or duration is given in years, convert all the formats to "Feb 2022 - Mar 2023". If date or duration is not given, do not add it.
Overall, the resumes might contain information from work experience, projects, skills to extracurriculars like hackathons, open-source contributions, competitions, etc. Add all of them to the JSON.

Structure the JSON as follows:
{
  "name": "Full Name",
  "location": "City, State/Country",
  "email": "email address",
  "phone": "phone number",
  "links": [
    { "label": "GitHub or LinkedIn or Portfolio", "url": "https://..." }
  ],
  "workExperience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "duration": "Start Date - End Date",
      "description": [
        "Point 1",
        "Point 2",
        "Point 3"
      ],
      "url": "Link to Internship Certificates if any"
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": [
        "Point 1",
        "Point 2",
        "Point 3"
      ],
      "url": "Link to project if any"
    }
  ],
  "education": [
    {
      "institution": "School Name",
      "degree": "Degree and Major",
      "duration": "Start - End Date"
    }
  ],
  "skills": ["Skill 1", "Skill 2"],
  "extracurriculars":{
    "hackathons": [
      {
        "name": "Hackathon Name",
        "duration": "Start Date - End Date",
        "description": [
          "Point 1",
          "Point 2",
          "Point 3"
        ],
        "url": "Link to project/certificates if any"
      }
    ],
     "open-source": [
      {
        "name": "Contributing Organization Name",
        "duration": "Start Date - End Date",
        "description": [
          "Point 1",
          "Point 2",
          "Point 3"
        ],
        "url": "Link to PRs/badges if any"
      }
    ],
    "competitions": [
      {
        "name": "Competition Name",
        "duration": "Start Date - End Date",
        "description": [
          "Point 1",
          "Point 2",
          "Point 3"
        ],
        "url": "Link to certificates if any"
      }
    ],
    "otherExtracurriculars": [
      {
        "name": "Extracurricular Name",
        "duration": "Start Date - End Date",
        "description": [
          "Point 1",
          "Point 2",
          "Point 3"
        ],
        "url": "Link to certificates/work if any"
      }
    ]
  }
}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: 'application/pdf',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    if (!response.text) throw new Error('Empty extraction response');
    return response.text;
  },
});

const protectedPost = createBotProtectedPost({
  route: '/api/extract-resume',
  verifyToken: (token) => adminAuth.verifyIdToken(token, true),
  handler: extractResume,
  unauthorizedMessage: 'Sign in again to upload your resume.',
});

export const POST = instrumentApiRoute({
  route: '/api/extract-resume',
  event: 'resume_extraction',
  durationMetric: 'resume_extraction.duration_ms',
  provider: 'gemini',
}, protectedPost);

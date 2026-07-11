import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

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
        {"Point 1"},
        {"Point 2"},
        {"Point 3"}
      ],
      "url": "Link to Internship Certificates if any"
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": [
        {"Point 1"},
        {"Point 2"},
        {"Point 3"}
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
          {"Point 1"},
          {"Point 2"},
          {"Point 3"}
        ],
        "url": "Link to project/certificates if any"
      }
    ],
     "open-source": [
      {
        "name": "Contributing Organization Name",
        "duration": "Start Date - End Date",
        "description": [
          {"Point 1"},
          {"Point 2"},
          {"Point 3"}
        ],
        "url": "Link to PRs/badges if any"
      }
    ],
    "competitions": [
      {
        "name": "Competition Name",
        "duration": "Start Date - End Date",
        "description": [
          {"Point 1"},
          {"Point 2"},
          {"Point 3"}
        ],
        "url": "Link to certificates if any"
      }
    ],
    "otherExtracurriculars": [
      {
        "name": "Extracurricular Name",
        "duration": "Start Date - End Date",
        "description": [
          {"Point 1"},
          {"Point 2"},
          {"Point 3"}
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

    const text = response.text || "{}";
    const jsonParsed = JSON.parse(text);

    return NextResponse.json({ text: JSON.stringify(jsonParsed, null, 2) });
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    return NextResponse.json(
      { error: 'Failed to extract text from PDF' },
      { status: 500 }
    );
  }
}

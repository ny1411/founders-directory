import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { adminAuth } from '@/lib/firebase-admin';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    
    const { founderId, companySlug } = await req.json();

    const user = await prisma.user.findUnique({
      where: { firebaseId: decodedToken.uid },
    });

    if (!user || !user.resumeText) {
      return NextResponse.json({ error: 'User resume not found' }, { status: 404 });
    }

    const company = await prisma.company.findUnique({
      where: { slug: companySlug },
    });

    const founder = await prisma.founder.findUnique({
      where: { id: founderId },
    });

    if (!company || !founder) {
      return NextResponse.json({ error: 'Company or founder not found' }, { status: 404 });
    }

    const prompt = `
You are an expert sales and networking assistant. 
Your task is to write a highly personalized, compelling, and concise cold DM (under 150 words) to a startup founder on LinkedIn or Twitter.

Context about the sender (from their resume):
${user.resumeText}

Context about the company:
Name: ${company.name}
Description: ${company.description || company.oneLiner || 'A startup'}
Industry: ${company.industry || 'Tech'}

Context about the recipient (the founder):
Name: ${founder.name}
Role: ${founder.role || 'Founder'}
Bio: ${founder.bio || 'Founder'}

Write a cold DM that the sender can send to the founder. The DM should:
1. Have a catchy but professional opening.
2. Highlight a specific connection or relevant experience from the sender's resume that aligns with the company's mission or the founder's background.
3. Be respectful of their time and end with a soft call to action (e.g., asking for a brief chat or simply offering value).
4. Do NOT include placeholders like [Your Name], just write the text naturally so they can copy and paste it (you can sign off with a generic 'Best,' but it's better to just write the core message).
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    return NextResponse.json({ dmText: response.text });
  } catch (error) {
    console.error('Error generating DM:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error generating DM' }, { status: 500 });
  }
}

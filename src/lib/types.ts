export interface Company {
  id: string;
  slug: string;
  name: string;
  oneLiner: string | null;
  description: string | null;
  logoUrl: string | null;
  vcBacker: string | null;
  industry: string | null;
  employees: string | null;
  location: string | null;
  foundedYear: number | null;
  website: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  tags: string | null;
  ycUrl: string | null;
  createdAt: string; // Stored as ISO string
  updatedAt: string; // Stored as ISO string
}

export interface Founder {
  id: string;
  companyId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  firebaseId: string;
  email: string;
  resumeText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedMessage {
  id: string;
  userId: string;
  founderId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

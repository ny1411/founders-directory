'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { auth } from '@/lib/firebase';

interface Link { label: string; url: string; }
interface WorkExperience { company: string; role: string; duration: string; description: string | string[] | Record<string, string>[]; url?: string; }
interface Project { name: string; description: string | string[] | Record<string, string>[]; url?: string; }
interface Education { institution: string; degree: string; duration: string; url?: string; }
interface Certificate { name: string; issuer: string; date: string; url?: string; }
interface Extracurricular { name: string; duration: string; description: string | string[] | Record<string, string>[]; url?: string; }
interface ResumeData {
  name?: string;
  location?: string;
  email?: string;
  phone?: string;
  links?: Link[];
  workExperience?: WorkExperience[];
  projects?: Project[];
  education?: Education[];
  skills?: string[];
  certificates?: Certificate[];
  extracurriculars?: {
    hackathons?: Extracurricular[];
    competitions?: Extracurricular[];
    otherExtracurriculars?: Extracurricular[];
    [key: string]: Extracurricular[] | undefined;
  };
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [resumeText, setResumeText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/profile', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.resumeText) setResumeText(data.resumeText);
        }
      } catch (err) {
        console.error('Failed to fetch profile', err);
      }
    };
    fetchProfile();
  }, [user]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setMessage('');
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/extract-resume', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setResumeText(data.text);
        setMessage('Resume extracted successfully! Review and hit Save.');
      } else {
        setMessage('Failed to extract resume.');
      }
    } catch (err) {
      console.error('Extraction error:', err);
      setMessage('Error extracting resume.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ resumeText }),
      });
      
      if (res.ok) {
        setMessage('Resume saved successfully!');
        router.push('/');
      } else {
        setMessage('Failed to save resume.');
      }
    } catch {
      setMessage('Error saving resume.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await auth?.signOut();
    router.push('/');
  };

  if (loading || !user) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif text-foreground">Your Profile</h1>
        <button onClick={handleLogout} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Logout
        </button>
      </div>

      <div className="space-y-8">
        {/* Card 1: Upload/Update */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-medium mb-2">Upload Resume</h2>
          <p className="text-secondary-foreground text-sm mb-6">
            Upload your PDF resume to generate a structured profile. This information is used for customized cold DMs.
          </p>

          <div className="mb-4">
            <input 
              type="file" 
              accept="application/pdf"
              onChange={handleFileUpload}
              disabled={isExtracting}
              className="block w-full text-sm text-foreground
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-primary/10 file:text-primary
                hover:file:bg-primary/20
                cursor-pointer"
            />
            {isExtracting && <span className="text-sm text-muted-foreground mt-2 block">Extracting text from PDF...</span>}
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-green-500">{message}</span>
            <button 
              onClick={handleSave} 
              disabled={isSaving || !resumeText}
              className={buttonVariants({ variant: "default" })}
            >
              {isSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>

        {/* Structured Profile Views */}
        {(() => {
          let parsed: ResumeData | null = null;
          try {
            if (resumeText) parsed = JSON.parse(resumeText);
          } catch {
            return (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h2 className="text-xl font-medium mb-2 text-destructive">Invalid Resume Data</h2>
                <p className="text-sm text-muted-foreground">The resume data could not be parsed as structured information.</p>
                <textarea
                  className="w-full h-64 p-4 mt-4 rounded-xl border border-border bg-background text-foreground resize-y focus:outline-none"
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                />
              </div>
            );
          }

          if (!parsed) return null;

          const renderDescription = (desc: string | string[] | Record<string, string>[] | undefined) => {
            if (!desc) return null;
            if (Array.isArray(desc)) {
              return (
                <ul className="list-disc list-inside space-y-1 mt-2 text-sm text-secondary-foreground">
                  {desc.map((point: string | Record<string, string>, idx: number) => (
                    <li key={idx}>
                      {typeof point === 'string' ? point : Object.values(point)[0] as string}
                    </li>
                  ))}
                </ul>
              );
            }
            return <p className="mt-2 text-sm text-secondary-foreground">{desc}</p>;
          };

          return (
            <>
              {/* Card 2: Personal Details */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Personal Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">Name</h3>
                    <p className="text-foreground">{parsed.name || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">Location</h3>
                    <p className="text-foreground">{parsed.location || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">Email</h3>
                    <p className="text-foreground">{parsed.email || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">Phone</h3>
                    <p className="text-foreground">{parsed.phone || 'N/A'}</p>
                  </div>
                </div>
                {parsed.links && parsed.links.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">Socials & Links</h3>
                    <div className="flex flex-wrap gap-3">
                      {parsed.links.map((link: Link, idx: number) => (
                        <a key={idx} href={link.url} target="_blank" rel="noreferrer" className="text-primary hover:underline text-sm font-medium">
                          {link.label || link.url}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: Work Experience */}
              {parsed.workExperience && parsed.workExperience.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Work Experience</h2>
                  <div className="space-y-6">
                    {parsed.workExperience.map((exp: WorkExperience, idx: number) => (
                      <div key={idx} className={idx !== (parsed.workExperience?.length || 0) - 1 ? "border-b border-border pb-6" : ""}>
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            {exp.company}
                            {exp.url && (
                              <a href={exp.url} target="_blank" rel="noreferrer" className="text-primary text-sm font-normal hover:underline">
                                (Link)
                              </a>
                            )}
                          </h3>
                          <span className="text-sm font-medium text-muted-foreground bg-secondary px-2 py-1 rounded">{exp.duration}</span>
                        </div>
                        <p className="text-primary font-medium mb-2">{exp.role}</p>
                        {renderDescription(exp.description)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 4: Projects */}
              {parsed.projects && parsed.projects.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Projects</h2>
                  <div className="space-y-6">
                    {parsed.projects.map((proj: Project, idx: number) => (
                      <div key={idx} className={idx !== (parsed.projects?.length || 0) - 1 ? "border-b border-border pb-6" : ""}>
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            {proj.name}
                            {proj.url && (
                              <a href={proj.url} target="_blank" rel="noreferrer" className="text-primary text-sm font-normal hover:underline">
                                (Link)
                              </a>
                            )}
                          </h3>
                        </div>
                        {renderDescription(proj.description)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 5: Education */}
              {parsed.education && parsed.education.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Education</h2>
                  <div className="space-y-4">
                    {parsed.education.map((edu: Education, idx: number) => (
                      <div key={idx} className="flex justify-between items-start">
                        <div>
                          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            {edu.institution}
                            {edu.url && (
                              <a href={edu.url} target="_blank" rel="noreferrer" className="text-primary text-sm font-normal hover:underline">
                                (Link)
                              </a>
                            )}
                          </h3>
                          <p className="text-secondary-foreground">{edu.degree}</p>
                        </div>
                        <span className="text-sm font-medium text-muted-foreground bg-secondary px-2 py-1 rounded">{edu.duration}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 6: Skills */}
              {parsed.skills && parsed.skills.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Skills</h2>
                  <div className="flex flex-wrap gap-2">
                    {parsed.skills.map((skill: string, idx: number) => (
                      <span key={idx} className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 7: Certificates */}
              {parsed.certificates && parsed.certificates.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Certificates</h2>
                  <div className="space-y-4">
                    {parsed.certificates.map((cert: Certificate, idx: number) => (
                      <div key={idx} className="flex justify-between items-start">
                        <div>
                          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            {cert.name}
                            {cert.url && (
                              <a href={cert.url} target="_blank" rel="noreferrer" className="text-primary text-sm font-normal hover:underline">
                                (Link)
                              </a>
                            )}
                          </h3>
                          <p className="text-secondary-foreground">{cert.issuer}</p>
                        </div>
                        {cert.date && <span className="text-sm font-medium text-muted-foreground bg-secondary px-2 py-1 rounded">{cert.date}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 8: Extracurriculars */}
              {parsed.extracurriculars && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h2 className="text-xl font-medium border-b border-border pb-3 mb-4">Extracurriculars</h2>
                  <div className="space-y-6">
                    {['hackathons', 'competitions', 'otherExtracurriculars'].map((cat) => {
                      const items = parsed.extracurriculars?.[cat];
                      if (!items || items.length === 0) return null;
                      
                      const title = cat === 'hackathons' ? 'Hackathons' : 
                                    cat === 'competitions' ? 'Competitions' : 
                                    'Other Activities';
                      
                      return (
                        <div key={cat}>
                          <h3 className="text-lg font-semibold text-foreground mb-3">{title}</h3>
                          <div className="space-y-4 pl-4 border-l-2 border-border/50">
                            {items.map((item: Extracurricular, idx: number) => (
                              <div key={idx}>
                                <div className="flex justify-between items-start mb-1">
                                  <h4 className="font-medium text-foreground flex items-center gap-2">
                                    {item.name}
                                    {item.url && (
                                      <a href={item.url} target="_blank" rel="noreferrer" className="text-primary text-xs font-normal hover:underline">
                                        (Link)
                                      </a>
                                    )}
                                  </h4>
                                  <span className="text-xs font-medium text-muted-foreground">{item.duration}</span>
                                </div>
                                {renderDescription(item.description)}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

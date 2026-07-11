'use client'

import { useState } from 'react'
import { createCompany } from '@/app/actions'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function NewCompanyPage() {
  const [founderCount, setFounderCount] = useState(1)

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-20">
      <div>
        <Link href="/" className={buttonVariants({ variant: "ghost", className: "mb-4 -ml-4" })}>
          ← Back to Directory
        </Link>
        <h1 className="text-4xl font-bold tracking-tight uppercase mb-2">Add New Company</h1>
        <p className="text-muted-foreground">Fill in the details below to add a new company to the directory.</p>
      </div>

      <form action={createCompany} className="flex flex-col gap-8">
        {/* Company Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Company Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">Company Name *</label>
              <Input id="name" name="name" required placeholder="e.g. Acme Corp" />
            </div>
            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium">URL Slug *</label>
              <Input id="slug" name="slug" required placeholder="e.g. acme-corp" />
            </div>
            
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="description" className="text-sm font-medium">Description</label>
              <textarea 
                id="description" 
                name="description" 
                className="w-full flex min-h-[100px] rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                placeholder="A brief description of the company..."
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="website" className="text-sm font-medium">Website</label>
              <Input id="website" name="website" placeholder="https://..." />
            </div>
            <div className="space-y-2">
              <label htmlFor="logoUrl" className="text-sm font-medium">Logo URL</label>
              <Input id="logoUrl" name="logoUrl" placeholder="https://..." />
            </div>

            <div className="space-y-2">
              <label htmlFor="vcBacker" className="text-sm font-medium">VC Backer</label>
              <Input id="vcBacker" name="vcBacker" placeholder="e.g. YCombinator" />
            </div>
            <div className="space-y-2">
              <label htmlFor="industry" className="text-sm font-medium">Industry</label>
              <Input id="industry" name="industry" placeholder="e.g. Fintech" />
            </div>

            <div className="space-y-2">
              <label htmlFor="employees" className="text-sm font-medium">Employees</label>
              <Input id="employees" name="employees" placeholder="e.g. 50-100" />
            </div>
            <div className="space-y-2">
              <label htmlFor="location" className="text-sm font-medium">Location</label>
              <Input id="location" name="location" placeholder="e.g. San Francisco, CA" />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="foundedYear" className="text-sm font-medium">Founded Year</label>
              <Input id="foundedYear" name="foundedYear" type="number" placeholder="e.g. 2020" />
            </div>
            <div className="space-y-2">
              <label htmlFor="stage" className="text-sm font-medium">Stage</label>
              <Input id="stage" name="stage" placeholder="e.g. Series A" />
            </div>
            
            <div className="space-y-2"></div>

            <div className="space-y-2">
              <label htmlFor="twitterUrl" className="text-sm font-medium">Twitter URL</label>
              <Input id="twitterUrl" name="twitterUrl" placeholder="https://twitter.com/..." />
            </div>
            <div className="space-y-2">
              <label htmlFor="linkedinUrl" className="text-sm font-medium">LinkedIn URL</label>
              <Input id="linkedinUrl" name="linkedinUrl" placeholder="https://linkedin.com/company/..." />
            </div>
          </CardContent>
        </Card>

        {/* Founders */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-2xl font-bold tracking-tight uppercase">Founders</h2>
            <Button type="button" variant="outline" onClick={() => setFounderCount(prev => prev + 1)}>
              + Add Founder
            </Button>
          </div>

          {Array.from({ length: founderCount }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="text-lg">Founder {i + 1}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_name`} className="text-sm font-medium">Name *</label>
                  <Input id={`founder_${i}_name`} name={`founder_${i}_name`} required placeholder="Founder Name" />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_role`} className="text-sm font-medium">Role</label>
                  <Input id={`founder_${i}_role`} name={`founder_${i}_role`} placeholder="e.g. CEO" />
                </div>
                
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor={`founder_${i}_bio`} className="text-sm font-medium">Bio</label>
                  <textarea 
                    id={`founder_${i}_bio`}
                    name={`founder_${i}_bio`}
                    className="w-full flex min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    placeholder="Short bio..."
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_email`} className="text-sm font-medium">Email</label>
                  <Input id={`founder_${i}_email`} name={`founder_${i}_email`} type="email" placeholder="email@example.com" />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_phone`} className="text-sm font-medium">Phone</label>
                  <Input id={`founder_${i}_phone`} name={`founder_${i}_phone`} placeholder="+1..." />
                </div>

                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_twitterUrl`} className="text-sm font-medium">Twitter URL</label>
                  <Input id={`founder_${i}_twitterUrl`} name={`founder_${i}_twitterUrl`} placeholder="https://twitter.com/..." />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_linkedinUrl`} className="text-sm font-medium">LinkedIn URL</label>
                  <Input id={`founder_${i}_linkedinUrl`} name={`founder_${i}_linkedinUrl`} placeholder="https://linkedin.com/in/..." />
                </div>
                
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor={`founder_${i}_avatarUrl`} className="text-sm font-medium">Avatar URL</label>
                  <Input id={`founder_${i}_avatarUrl`} name={`founder_${i}_avatarUrl`} placeholder="https://..." />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button type="submit" size="lg" className="w-full md:w-auto self-end">
          Save Company
        </Button>
      </form>
    </div>
  )
}

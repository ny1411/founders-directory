import { ImageResponse } from 'next/og'
import { adminDb } from "@/lib/firebase-admin"
import { Company } from "@/lib/types"

export const alt = 'Company Profile on Founders Directory'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const companySnapshot = await adminDb.collection('companies').where('slug', '==', params.slug).limit(1).get();
  
  if (companySnapshot.empty) {
    return new ImageResponse(
      (
        <div style={{ background: '#09090b', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'sans-serif' }}>
          <h1 style={{ fontSize: '48px' }}>Company Not Found</h1>
        </div>
      ), { ...size }
    )
  }

  const company = companySnapshot.docs[0].data() as Company;

  return new ImageResponse(
    (
      <div
        style={{
          backgroundImage: `url(${new URL('../../../../public/images/og/og-bg.jpg', import.meta.url).toString()})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',

          // fallback bg
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img 
            src={company.logoUrl} 
            alt="Logo" 
            style={{ width: '160px', height: '160px', borderRadius: '32px', marginBottom: '40px', border: '1px solid #27272a' }} 
          />
        )}
        <h1 style={{ fontSize: '80px', fontWeight: 'bold', margin: '0 0 24px 0', textAlign: 'center', letterSpacing: '-0.02em' }}>
          {company.name}
        </h1>
        {company.oneLiner && (
          <p style={{ fontSize: '40px', color: '#a1a1aa', margin: 0, textAlign: 'center', maxWidth: '85%', lineHeight: 1.4 }}>
            {company.oneLiner}
          </p>
        )}
        <div style={{ position: 'absolute', bottom: '48px', display: 'flex', alignItems: 'center', color: '#71717a' }}>
          <span style={{ fontSize: '28px', fontWeight: '600' }}>Founders Directory</span>
        </div>
      </div>
    ), { ...size }
  )
}

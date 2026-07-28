import { ImageResponse } from 'next/og'

export const alt = 'Founders Directory'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          backgroundImage: `url(${new URL('../../public/images/og/og-bg.jpg', import.meta.url).toString()})`,
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
          fontFamily: 'sans-serif',
          color: 'white',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '72px', fontWeight: 'bold', margin: 0, letterSpacing: '-0.02em' }}>
            Founders Directory
          </h1>
        </div>
        <p style={{ fontSize: '36px', color: '#a1a1aa', margin: 0, textAlign: 'center' }}>
          Send Outreach Messages directly to Founders.
        </p>
      </div>
    ),
    { ...size }
  )
}

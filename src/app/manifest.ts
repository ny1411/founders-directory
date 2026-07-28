import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Founders Directory',
    short_name: 'FoundersDir',
    description: 'Discover YC startups and VC-backed founders.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#000000',
    icons: [
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}

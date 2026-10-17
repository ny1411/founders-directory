import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SmoothScrolling } from "@/components/smooth-scrolling";
import { AuthProvider } from "@/context/AuthContext";
import { HeaderAuth } from "@/components/header-auth";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  variable: "--font-instrument-serif",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://foundersdirectory.com"),
  title: {
    default: "Founders Directory | YC Startups & Founder Search",
    template: "%s | Founders Directory",
  },
  applicationName: "Founders Directory",
  authors: [{ name: "Neeraj Yamaji", url: "https://foundersdirectory.com" }],
  creator: "Neeraj Yamaji",
  publisher: "Neeraj Yamaji",
  category: "Technology",
  referrer: "origin-when-cross-origin",
  keywords: [
    "YC",
    "YCombinator",
    "Startup founders",
    "Startup Directory",
    "VC",
    "Startup",
    "Founder",
    "Founder Search",
    "Cold Email Generator",
    "Cold Outreach Generator",
    "Developer Tools",
    "AI Outreach"
  ],
  description: "Discover YC startups and VC-backed founders. Search startups, find founders, generate AI-powered outreach texts.",
  appleWebApp: {
    capable: true,
    title: "Founders Directory",
    statusBarStyle: "default",
  },
  alternates: {
    canonical: "/",
  },
  verification: {
    google: "google-site-verification-id",
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: "Founders Directory | YC Startup & Founder Search",
    description: "Discover YC startups and VC-backed founders. A premium directory to search startup data, find founder socials, and generate AI-powered cold outreach DMs.",
    url: "/",
    siteName: "Founders Directory",
    images: [
      {
        url: "/images/og/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Founders Directory"
      }
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Founders Directory | YC Startup & Founder Search",
    description: "Discover YC startups and VC-backed founders. A premium directory to search startup data, find founder socials, and generate AI-powered cold outreach DMs.",
    images: ["/images/og/og-image.jpg"],
    creator: "@n_y_1411",
    site: "@n_y_1411",
  },
  icons: {
    apple: "/apple-touch-icon.png"
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <SmoothScrolling>
              <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
                <div className="container max-w-5xl flex h-16 items-center mx-auto px-4">
                  <div className="mr-4 flex">
                    <Link className="mr-6 flex items-center space-x-2" href="/">
                      <Image src="/icon.png" width={48} height={48} alt="Founders Directory Logo" className="rounded-md" />
                      <span className="font-serif text-2xl tracking-tight sm:inline-block">
                        Founders Directory
                      </span>
                    </Link>
                  </div>
                  <div className="ml-auto flex items-center space-x-4">
                    <HeaderAuth />
                    <ThemeToggle />
                  </div>
                </div>
              </header>
              <main className="flex-1 container max-w-5xl mx-auto px-4 py-8">
                {children}
              </main>
            </SmoothScrolling>
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}

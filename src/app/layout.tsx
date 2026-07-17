import type { Metadata } from "next";
import { Inter, Instrument_Serif, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SmoothScrolling } from "@/components/smooth-scrolling";
import { AuthProvider } from "@/context/AuthContext";
import { HeaderAuth } from "@/components/header-auth";

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

export const metadata: Metadata = {
  title: "Founders Directory",
  description: "Browse companies backed by top VCs.",
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
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter, Instrument_Serif, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SmoothScrolling } from "@/components/smooth-scrolling";

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
  title: "VC Portfolio Directory",
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
      className={`${inter.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <SmoothScrolling>
            <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
              <div className="container max-w-5xl flex h-16 items-center mx-auto px-4">
                <div className="mr-4 flex">
                  <Link className="mr-6 flex items-center space-x-2" href="/">
                    <span className="font-serif text-2xl tracking-tight sm:inline-block">
                      VC Portfolio Directory
                    </span>
                  </Link>
                </div>
                <div className="ml-auto flex items-center space-x-4">
                  <ThemeToggle />
                </div>
              </div>
            </header>
            <main className="flex-1 container max-w-5xl mx-auto px-4 py-8">
              {children}
            </main>
          </SmoothScrolling>
        </ThemeProvider>
      </body>
    </html>
  );
}

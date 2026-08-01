import type { Metadata } from "next";
import { Playfair_Display, Jost } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { BUSINESS, DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

const playfairDisplay = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const jost = Jost({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "Nocturne Studio | Columbia, MO Portrait & Boudoir Photographer",
    template: `%s | ${SITE_NAME}`,
  },
  description: BUSINESS.description,
  keywords: [
    "Columbia Missouri portrait photographer",
    "Mid-Missouri boudoir photography",
    "Columbia MO boudoir photographer",
    "portrait photographer Columbia MO",
    "fine art photography Missouri",
  ],
  openGraph: {
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    images: [DEFAULT_OG_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
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
      className={`${playfairDisplay.variable} ${jost.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Navbar />
        <main className="flex-1 pt-20">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

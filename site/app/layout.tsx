import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { withBasePath } from "@/lib/base-path"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Silo — Save it → Schedule it",
  description: "Turn screenshots and links into action. Auto-tags, reels-style feed, one-tap calendar.",
  icons: {
    icon: [
      {
        url: withBasePath("/icon-light-32x32.png"),
        media: "(prefers-color-scheme: light)",
      },
      {
        url: withBasePath("/icon-dark-32x32.png"),
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: withBasePath("/icon.svg"),
        type: "image/svg+xml",
      },
    ],
    apple: withBasePath("/apple-icon.png"),
  },
  openGraph: {
    title: "Silo — Save it → Schedule it",
    description: "Turn screenshots and links into action. Auto-tags, reels-style feed, one-tap calendar.",
    url: "https://silo.photo",
    siteName: "Silo",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Silo — Save it → Schedule it",
    description: "Turn screenshots and links into action. Auto-tags, reels-style feed, one-tap calendar.",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}

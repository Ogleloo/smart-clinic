import type { Metadata } from 'next'
import { Hanken_Grotesk, Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Riverside Clinic — Know where you stand',
  description: 'Book appointments, skip the queue, and see your real wait time.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}

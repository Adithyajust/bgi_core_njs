import "./globals.css"
import { AppShell } from "@/components/app-shell"

export const metadata = {
  title: "BGI Core Application",
  description:
    "Corporate Cash Management Dashboard",
}

export default function RootLayout({
  children,
}) {
  return (
    <html
      lang="id"
      data-scroll-behavior="smooth"
    >
      <body>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
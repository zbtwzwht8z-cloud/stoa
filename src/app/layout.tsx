import type { Metadata } from "next";
import "./globals.css";
import "./design-system.css";

export const metadata: Metadata = {
  title: "Stoa",
  description: "The modern digital space for mastering your exams.",
  manifest: "/manifest.webmanifest"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

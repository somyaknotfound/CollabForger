import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CollabForge",
  description: "Real-time collaborative document editor with an AI agent participant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

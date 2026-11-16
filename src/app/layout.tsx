import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anli Demo Tester",
  description: "Local webhook receiver and event inbox for Anli hotel notifications.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

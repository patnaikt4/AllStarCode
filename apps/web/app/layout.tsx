import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Lesson Video Feedback Tool",
  description: "All Star Code – instructor feedback and lesson planning",
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

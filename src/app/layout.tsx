import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LOW — Your agents remember, and you own the memory',
  description:
    'Multi-tenant Markdown Vault, Grounded Gemini Memory, and Deterministic Internal App Builder on Google Cloud.',
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

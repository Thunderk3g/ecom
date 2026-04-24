import type { ReactNode } from 'react';

export const metadata = { title: 'Stationery Store', description: 'Paper goods, properly.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

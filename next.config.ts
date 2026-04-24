import type { NextConfig } from 'next';

const config: NextConfig = {
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;

import type { NextConfig } from 'next';

const config: NextConfig = {
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Keep the Sentry/OpenTelemetry instrumentation stack OUT of the webpack
  // bundle. These packages do dynamic `require()` / native-module tricks
  // (require-in-the-middle, import-in-the-middle) that webpack can't statically
  // resolve — bundling them surfaces as `Can't resolve 'path'` from
  // module-details-from-path and 500s every route. Marking them external makes
  // Next require them from node_modules at runtime, where Node builtins exist.
  serverExternalPackages: [
    '@sentry/node',
    '@sentry/node-core',
    '@opentelemetry/instrumentation',
    'require-in-the-middle',
    'import-in-the-middle',
    'module-details-from-path',
  ],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
  },
};

export default config;

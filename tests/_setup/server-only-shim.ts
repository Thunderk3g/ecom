// No-op stand-in for the `server-only` package under vitest. In a Next build,
// importing `server-only` from a client bundle is a hard error; that guard is
// compile-time and irrelevant in the node test environment, but the bare
// specifier still has to resolve. Aliased in vitest.config.ts.
export {};

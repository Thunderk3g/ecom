// Re-export all tables here so drizzle-kit discovers them.
// Each domain adds its exports as tasks add tables.
export * from './tenancy';
export * from './identity';
export * from './sessions';

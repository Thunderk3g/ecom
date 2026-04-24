import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // opaque random 64-char hex
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
}));

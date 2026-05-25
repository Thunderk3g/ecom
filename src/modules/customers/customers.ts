/**
 * Customers module — store-scoped CRUD on top of the shared `users` identity.
 *
 * One row per (store_id, user_id) when the customer is logged-in; guest
 * customers carry user_id IS NULL and are deduped per (store_id, email) by
 * the partial unique indexes on `customers`. `upsertCustomer` understands
 * both shapes:
 *   - userId supplied -> lookup by (storeId, userId), merge fields
 *   - userId omitted  -> lookup by (storeId, email) WHERE user_id IS NULL,
 *                        merge fields (first-time guest order flow)
 *
 * Listing is cursor paginated (newest-first by `created_at`, tiebreak on `id`).
 */

import {
  and,
  desc,
  eq,
  ilike,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { customers } from '@/db/schema/customers';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import {
  CustomerNotFoundError,
  EmailConflictError,
} from './errors';

export type CustomerRow = typeof customers.$inferSelect;

export interface ListCustomersOptions {
  cursor?: string;
  limit?: number;
  /** Case-insensitive substring match against `email`. */
  email?: string;
  /** Exact match on `segment` (null-safe: '' is treated as "any"). */
  segment?: string;
}

export interface ListCustomersResult {
  items: CustomerRow[];
  nextCursor: string | null;
}

export interface UpsertCustomerInput {
  userId?: string | null;
  email: string;
  phone?: string | null;
  locale?: string;
  segment?: string | null;
  acceptsMarketing?: boolean;
}

export interface UpdateCustomerInput {
  email?: string;
  phone?: string | null;
  locale?: string;
  segment?: string | null;
  acceptsMarketing?: boolean;
  lifetimeValueCents?: number;
}

/**
 * Cursor-paginated customer listing, newest-first by `created_at desc`
 * with `id` as the deterministic tiebreaker. Cursor encodes `{ k: iso, id }`.
 */
export async function listCustomers(
  storeId: string,
  opts: ListCustomersOptions = {},
): Promise<ListCustomersResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [];

    if (opts.email && opts.email.length > 0) {
      filters.push(ilike(customers.email, `%${opts.email}%`));
    }
    if (opts.segment && opts.segment.length > 0) {
      filters.push(eq(customers.segment, opts.segment));
    }

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(customers.createdAt, cutoff),
            and(eq(customers.createdAt, cutoff), lt(customers.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(customers)
      .where(whereClause)
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  });
}

export async function getCustomer(
  storeId: string,
  customerId: string,
): Promise<CustomerRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!row) throw new CustomerNotFoundError(customerId);
    return row;
  });
}

/**
 * Lookup the store-scoped customer record for a logged-in user.
 * Returns null when the user has never transacted with this store.
 */
export async function getCustomerByUserId(
  storeId: string,
  userId: string,
): Promise<CustomerRow | null> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(customers)
      .where(eq(customers.userId, userId))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Lookup a customer by email. Used for guest-order merge: when an unauth'd
 * checkout comes in, we attach the order to an existing customer record (any
 * row — guest or registered — that matches the email).
 *
 * Returns the registered row when both a registered and a guest record exist
 * for the same email (defence: schema-level unique indexes prevent this from
 * happening in practice, but we prefer the user-bound row to avoid stranded
 * guest rows).
 */
export async function getCustomerByEmail(
  storeId: string,
  email: string,
): Promise<CustomerRow | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(customers)
      .where(eq(customers.email, email))
      // Prefer registered (user_id IS NOT NULL) over guest rows.
      .orderBy(sql`${customers.userId} IS NULL`, desc(customers.createdAt))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Idempotently create or merge a customer record.
 *
 *  - If `userId` is provided, lookup by (storeId, userId). When found, patch
 *    the row with any supplied fields; when missing, INSERT a new registered
 *    row. If a guest row already exists for the same email in this store, it
 *    is folded into the new registered row (its id is preserved by linking
 *    instead of creating a duplicate).
 *  - If `userId` is omitted, lookup by (storeId, email) WHERE user_id IS NULL.
 *    When found, patch; when missing, INSERT a guest row.
 *
 * Throws `EmailConflictError` if the supplied email is already bound to a
 * *different* registered user in this store.
 */
export async function upsertCustomer(
  storeId: string,
  input: UpsertCustomerInput,
): Promise<CustomerRow> {
  return withTenant(storeId, async tx => {
    const mergeFields = (): {
      phone?: string | null;
      locale?: string;
      segment?: string | null;
      acceptsMarketing?: boolean;
    } => {
      const patch: {
        phone?: string | null;
        locale?: string;
        segment?: string | null;
        acceptsMarketing?: boolean;
      } = {};
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.locale !== undefined) patch.locale = input.locale;
      if (input.segment !== undefined) patch.segment = input.segment;
      if (input.acceptsMarketing !== undefined) {
        patch.acceptsMarketing = input.acceptsMarketing;
      }
      return patch;
    };

    if (input.userId) {
      // Registered-customer path.
      const [existing] = await tx
        .select()
        .from(customers)
        .where(eq(customers.userId, input.userId))
        .limit(1);

      if (existing) {
        const patch = {
          ...mergeFields(),
          ...(input.email !== existing.email ? { email: input.email } : {}),
        };
        if (Object.keys(patch).length === 0) return existing;
        const [updated] = await tx
          .update(customers)
          .set(patch)
          .where(eq(customers.id, existing.id))
          .returning();
        if (!updated) throw new CustomerNotFoundError(existing.id);
        return updated;
      }

      // Check whether the supplied email is owned by a *different* registered
      // customer in this store. If so, reject — the caller must reconcile.
      const [otherRegistered] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.email, input.email),
            sql`${customers.userId} IS NOT NULL`,
          ),
        )
        .limit(1);
      if (otherRegistered) {
        throw new EmailConflictError(input.email);
      }

      // Fold guest row (if any) into the new registered row by flipping
      // user_id, preserving its id (and any orders that reference it).
      const [guestRow] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.email, input.email), isNull(customers.userId)))
        .limit(1);

      if (guestRow) {
        const [merged] = await tx
          .update(customers)
          .set({
            userId: input.userId,
            ...mergeFields(),
          })
          .where(eq(customers.id, guestRow.id))
          .returning();
        if (!merged) throw new CustomerNotFoundError(guestRow.id);
        return merged;
      }

      const [inserted] = await tx
        .insert(customers)
        .values({
          storeId,
          userId: input.userId,
          email: input.email,
          phone: input.phone ?? null,
          locale: input.locale ?? 'en-IN',
          segment: input.segment ?? null,
          acceptsMarketing: input.acceptsMarketing ?? false,
        })
        .returning();
      if (!inserted) throw new Error('customers insert returned no row');
      return inserted;
    }

    // Guest path: lookup by (storeId, email) WHERE user_id IS NULL.
    const [existingGuest] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.email, input.email), isNull(customers.userId)))
      .limit(1);

    if (existingGuest) {
      const patch = mergeFields();
      if (Object.keys(patch).length === 0) return existingGuest;
      const [updated] = await tx
        .update(customers)
        .set(patch)
        .where(eq(customers.id, existingGuest.id))
        .returning();
      if (!updated) throw new CustomerNotFoundError(existingGuest.id);
      return updated;
    }

    const [inserted] = await tx
      .insert(customers)
      .values({
        storeId,
        userId: null,
        email: input.email,
        phone: input.phone ?? null,
        locale: input.locale ?? 'en-IN',
        segment: input.segment ?? null,
        acceptsMarketing: input.acceptsMarketing ?? false,
      })
      .returning();
    if (!inserted) throw new Error('customers insert returned no row');
    return inserted;
  });
}

export async function updateCustomer(
  storeId: string,
  customerId: string,
  patch: UpdateCustomerInput,
): Promise<CustomerRow> {
  return withTenant(storeId, async tx => {
    const setPatch: {
      email?: string;
      phone?: string | null;
      locale?: string;
      segment?: string | null;
      acceptsMarketing?: boolean;
      lifetimeValueCents?: number;
    } = {};
    if (patch.email !== undefined) setPatch.email = patch.email;
    if (patch.phone !== undefined) setPatch.phone = patch.phone;
    if (patch.locale !== undefined) setPatch.locale = patch.locale;
    if (patch.segment !== undefined) setPatch.segment = patch.segment;
    if (patch.acceptsMarketing !== undefined) {
      setPatch.acceptsMarketing = patch.acceptsMarketing;
    }
    if (patch.lifetimeValueCents !== undefined) {
      setPatch.lifetimeValueCents = patch.lifetimeValueCents;
    }

    if (Object.keys(setPatch).length === 0) {
      const [row] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (!row) throw new CustomerNotFoundError(customerId);
      return row;
    }

    const [updated] = await tx
      .update(customers)
      .set(setPatch)
      .where(eq(customers.id, customerId))
      .returning();
    if (!updated) throw new CustomerNotFoundError(customerId);
    return updated;
  });
}

/**
 * Promote a guest customer row to a logged-in customer by setting its
 * `user_id`. Used by the registration/login flow when a freshly-authenticated
 * user has prior guest orders in this store.
 *
 * Throws:
 *  - CustomerNotFoundError if `customerId` doesn't exist in this tenant.
 *  - EmailConflictError if a *different* customer is already bound to the
 *    target `userId` in this store.
 */
export async function linkCustomerToUser(
  storeId: string,
  customerId: string,
  userId: string,
): Promise<CustomerRow> {
  return withTenant(storeId, async tx => {
    const [target] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!target) throw new CustomerNotFoundError(customerId);

    // No-op when already linked to this user.
    if (target.userId === userId) return target;

    // Refuse to clobber an existing link.
    const [conflict] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.userId, userId))
      .limit(1);
    if (conflict && conflict.id !== customerId) {
      throw new EmailConflictError(target.email);
    }

    const [updated] = await tx
      .update(customers)
      .set({ userId })
      .where(eq(customers.id, customerId))
      .returning();
    if (!updated) throw new CustomerNotFoundError(customerId);
    return updated;
  });
}

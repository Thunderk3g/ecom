import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { getAdminContext } from '../_lib/context';
import { PageHeader, CursorPager } from '../_lib/ui';
import { withTenant } from '@/modules/tenant/with-tenant';
import { auditLog } from '@/db/schema/audit';
import { users, storeUsers } from '@/db/schema/identity';
import {
  decodeCursor,
  encodeCursor,
  parseLimit,
  type CursorPayload,
} from '@/lib/cursor';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AuditFilters } from './_components/AuditFilters';
import { EntryRow, type AuditEntry } from './_components/EntryRow';

export const dynamic = 'force-dynamic';

/**
 * Append-only audit_log viewer. Keyset paginated by (created_at DESC, id DESC).
 * Filters: entity_type (free text), actor (user id), action (free text),
 * created_at date range (from / to inclusive). Query is inlined here — audit
 * is read-only from the admin UI so a dedicated module would be premature.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { storeId } = await getAdminContext();
  const params = await searchParams;

  const entityType = params.entityType?.trim() || undefined;
  const actorId = params.actorId?.trim() || undefined;
  const action = params.action?.trim() || undefined;
  const from = params.from?.trim() || undefined;
  const to = params.to?.trim() || undefined;
  const after = params.after || undefined;

  const limit = parseLimit(undefined);
  const cursor = decodeCursor(after);

  const { rows, nextCursor, actors } = await withTenant(storeId, async tx => {
    const conds: SQL[] = [eq(auditLog.storeId, storeId)];
    if (entityType) conds.push(eq(auditLog.entityType, entityType));
    if (actorId) conds.push(eq(auditLog.actorId, actorId));
    if (action) conds.push(eq(auditLog.action, action));
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        conds.push(gte(auditLog.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        // Include the whole "to" day when the user passed a date-only value.
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          toDate.setUTCHours(23, 59, 59, 999);
        }
        conds.push(lte(auditLog.createdAt, toDate));
      }
    }
    if (cursor) {
      const ts = new Date(cursor.k);
      if (!Number.isNaN(ts.getTime())) {
        conds.push(
          sql`(${auditLog.createdAt}, ${auditLog.id}) < (${ts.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
        );
      }
    }

    const whereExpr = and(...conds);

    const baseRows = await tx
      .select({
        id: auditLog.id,
        actorType: auditLog.actorType,
        actorId: auditLog.actorId,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        diff: auditLog.diff,
        createdAt: auditLog.createdAt,
        actorEmail: users.email,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(whereExpr)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit + 1);

    let pageRows = baseRows;
    let next: string | null = null;
    if (baseRows.length > limit) {
      pageRows = baseRows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      if (last) {
        const payload: CursorPayload = {
          k: last.createdAt.toISOString(),
          id: last.id,
        };
        next = encodeCursor(payload);
      }
    }

    // Actor options: the set of users with a membership in this store.
    const actorRows = await tx
      .select({ id: users.id, email: users.email })
      .from(storeUsers)
      .innerJoin(users, eq(users.id, storeUsers.userId))
      .where(eq(storeUsers.storeId, storeId))
      .orderBy(users.email);

    return { rows: pageRows, nextCursor: next, actors: actorRows };
  });

  const entries: AuditEntry[] = rows.map(r => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actorType: r.actorType,
    actorId: r.actorId,
    actorEmail: r.actorEmail,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    diff: r.diff ?? null,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Append-only record of admin actions and system events."
      />

      <AuditFilters
        entityType={entityType ?? ''}
        actorId={actorId ?? ''}
        action={action ?? ''}
        from={from ?? ''}
        to={to ?? ''}
        actors={actors}
      />

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <td
                  colSpan={6}
                  className="h-24 p-2 text-center align-middle text-sm text-muted-foreground"
                >
                  No audit entries match these filters.
                </td>
              </TableRow>
            ) : (
              entries.map(e => <EntryRow key={e.id} entry={e} />)
            )}
          </TableBody>
        </Table>
      </div>

      <CursorPager
        basePath="/admin/audit-log"
        nextCursor={nextCursor}
        params={{ entityType, actorId, action, from, to }}
      />
    </div>
  );
}

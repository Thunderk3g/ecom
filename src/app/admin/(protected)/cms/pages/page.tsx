import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listPages, type PageStatus } from '@/modules/cms/pages';
import {
  getCmsAdminContext,
  assertPermission,
  AdminContextError,
} from '../_lib/admin-context';
import { CreatePageDialog } from '../_components/CreatePageDialog';

export const dynamic = 'force-dynamic';

function statusVariant(status: PageStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'published') return 'default';
  if (status === 'archived') return 'outline';
  return 'secondary';
}

export default async function CmsPagesPage() {
  let ctx;
  try {
    ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:read');
  } catch (err) {
    if (err instanceof AdminContextError) redirect('/admin/login');
    throw err;
  }

  const pages = await listPages(ctx.storeId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content pages</h1>
          <p className="text-muted-foreground">Build and publish marketing pages from blocks.</p>
        </div>
        <CreatePageDialog />
      </div>

      {pages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No pages yet. Create your first content page.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map(page => (
                <TableRow key={page.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/cms/pages/${page.id}` as `/admin/cms/pages/${string}`}
                      className="hover:underline"
                    >
                      {page.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">/{page.slug}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(page.status)} className="capitalize">
                      {page.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(page.updatedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { listPages, type PageStatus } from '@/modules/cms/pages';
import {
  getCmsAdminContext,
  assertPermission,
  AdminContextError,
} from '../_lib/admin-context';
import { CreatePageDialog } from '../_components/CreatePageDialog';

export const dynamic = 'force-dynamic';

function statusClass(status: PageStatus): string {
  if (status === 'published') return 'sp-active';
  if (status === 'archived') return 'sp-out';
  return 'sp-draft';
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
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>Content pages</h2>
          <span className="t-sub">Build and publish marketing pages from blocks.</span>
        </div>
        <CreatePageDialog />
      </div>

      {pages.length === 0 ? (
        <div className="panel">
          <div className="panel-pad t-sub" style={{ textAlign: 'center', padding: 48 }}>
            No pages yet. Create your first content page.
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <h3>Pages</h3>
            <span className="t-sub">{pages.length} total</span>
          </div>
          <table className="dtable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {pages.map(page => (
                <tr key={page.id}>
                  <td>
                    <Link
                      href={`/admin/cms/pages/${page.id}` as `/admin/cms/pages/${string}`}
                      className="t-strong"
                    >
                      {page.title}
                    </Link>
                  </td>
                  <td className="t-sub">/{page.slug}</td>
                  <td>
                    <span className={`statpill ${statusClass(page.status)}`} style={{ textTransform: 'capitalize' }}>
                      {page.status}
                    </span>
                  </td>
                  <td className="t-sub">
                    {new Date(page.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

import { redirect } from 'next/navigation';

/** /admin/cms → the pages list (the primary CMS surface). */
export default function CmsIndexPage() {
  redirect('/admin/cms/pages');
}

import { PageHeader } from '../../_lib/ui';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default function ProductImportPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Import products"
        description="Upload a CSV to bulk-create products and variants."
      />
      <ImportForm />
    </div>
  );
}

import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default function ProductImportPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Import products
          </h2>
          <p className="t-sub" style={{ marginTop: 4 }}>
            Upload a CSV to bulk-create products and variants.
          </p>
        </div>
      </div>
      <ImportForm />
    </div>
  );
}

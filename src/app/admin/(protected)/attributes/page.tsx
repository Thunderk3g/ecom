import { getAdminContext } from '../_lib/context';
import { listAttributes } from '@/modules/catalog/attributes';
import { AttributesManager, type AttributeRow } from './AttributesManager';

export const dynamic = 'force-dynamic';

export default async function AttributesPage() {
  const { storeId } = await getAdminContext();
  const defs = await listAttributes(storeId);

  const rows: AttributeRow[] = defs.map(d => ({
    id: d.id,
    key: d.key,
    label: d.label,
    dataType: d.dataType,
    unit: d.unit,
    enumValues: d.enumValues ?? [],
    filterable: d.filterable,
    required: d.required,
  }));

  return <AttributesManager rows={rows} />;
}

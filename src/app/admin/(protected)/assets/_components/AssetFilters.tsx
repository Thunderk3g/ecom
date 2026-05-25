'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = '__all__';

export function AssetFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get('kind') ?? ALL;
  const tag = params.get('tag') ?? '';

  function apply(next: { kind?: string; tag?: string }) {
    const sp = new URLSearchParams(params.toString());
    // Reset pagination when filters change.
    sp.delete('after');
    const nextKind = next.kind ?? kind;
    const nextTag = next.tag ?? tag;
    if (nextKind && nextKind !== ALL) sp.set('kind', nextKind);
    else sp.delete('kind');
    if (nextTag.trim()) sp.set('tag', nextTag.trim());
    else sp.delete('tag');
    router.push(`/admin/assets?${sp.toString()}` as `/admin/assets`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={kind} onValueChange={value => apply({ kind: value })}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All kinds" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All kinds</SelectItem>
          <SelectItem value="image">Images</SelectItem>
          <SelectItem value="svg">SVG</SelectItem>
          <SelectItem value="doc">Documents</SelectItem>
        </SelectContent>
      </Select>
      <Input
        defaultValue={tag}
        placeholder="Filter by tag…"
        className="w-48"
        onKeyDown={e => {
          if (e.key === 'Enter') apply({ tag: (e.target as HTMLInputElement).value });
        }}
        onBlur={e => apply({ tag: e.target.value })}
      />
    </div>
  );
}

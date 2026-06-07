'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = '__any__';

export type ActorOption = { id: string; email: string };

type State = {
  entityType: string;
  actorId: string;
  action: string;
  from: string;
  to: string;
};

export function AuditFilters({
  entityType,
  actorId,
  action,
  from,
  to,
  actors,
}: State & { actors: ActorOption[] }) {
  const router = useRouter();
  const [state, setState] = useState<State>({
    entityType,
    actorId,
    action,
    from,
    to,
  });

  function push(next: State) {
    const params = new URLSearchParams();
    if (next.entityType) params.set('entityType', next.entityType);
    if (next.actorId) params.set('actorId', next.actorId);
    if (next.action) params.set('action', next.action);
    if (next.from) params.set('from', next.from);
    if (next.to) params.set('to', next.to);
    const qs = params.toString();
    router.push(
      (qs
        ? `/admin/audit-log?${qs}`
        : '/admin/audit-log') as Parameters<typeof router.push>[0],
    );
  }

  function update<K extends keyof State>(key: K, value: State[K]) {
    setState(s => ({ ...s, [key]: value }));
  }

  function clearAll() {
    const cleared: State = {
      entityType: '',
      actorId: '',
      action: '',
      from: '',
      to: '',
    };
    setState(cleared);
    push(cleared);
  }

  return (
    <form
      className="flex w-full flex-wrap items-end gap-3"
      onSubmit={e => {
        e.preventDefault();
        push(state);
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="audit-entity-type">Entity type</Label>
        <Input
          id="audit-entity-type"
          placeholder="e.g. product"
          value={state.entityType}
          onChange={e => update('entityType', e.target.value)}
          className="w-44"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label>Actor</Label>
        <div className="w-56">
          <Select
            value={state.actorId || ANY}
            onValueChange={v => update('actorId', v === ANY ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any actor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any actor</SelectItem>
              {actors.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="audit-action">Action</Label>
        <Input
          id="audit-action"
          placeholder="e.g. product.update"
          value={state.action}
          onChange={e => update('action', e.target.value)}
          className="w-48"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="audit-from">From</Label>
        <Input
          id="audit-from"
          type="date"
          value={state.from}
          onChange={e => update('from', e.target.value)}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="audit-to">To</Label>
        <Input
          id="audit-to"
          type="date"
          value={state.to}
          onChange={e => update('to', e.target.value)}
          className="w-40"
        />
      </div>

      <div className="flex items-end gap-2">
        <button type="submit" className="btn btn-clay btn-sm">
          Apply
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
          Clear
        </button>
      </div>
    </form>
  );
}

'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { BlockKind } from '@/modules/cms/blocks';
import { BLOCK_SPECS, type FieldSpec } from '../_lib/block-fields';

/**
 * Generic per-block form. Renders one control per FieldSpec for the block kind.
 * `text`/`textarea`/`number`/`select` map to scalar props; `json` lets the
 * editor author structured props (image refs, arrays, nested blocks) as raw
 * JSON. Authoritative validation runs server-side on save.
 */
export function BlockFields({
  kind,
  props,
  onChange,
}: {
  kind: BlockKind;
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const spec = BLOCK_SPECS[kind];

  function setField(key: string, value: unknown) {
    const next = { ...props };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {spec.fields.map(field => (
        <Field
          key={field.key}
          field={field}
          value={props[field.key]}
          onChange={value => setField(field.key, value)}
        />
      ))}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `field-${field.key}`;
  const wide = field.type === 'textarea' || field.type === 'json';

  return (
    <div className={wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
      <Label htmlFor={id}>{field.label}</Label>
      {field.type === 'text' ? (
        <Input
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      ) : field.type === 'number' ? (
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      ) : field.type === 'textarea' ? (
        <Textarea
          id={id}
          rows={6}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      ) : field.type === 'select' ? (
        <Select
          value={typeof value === 'string' ? value : (field.defaultValue as string | undefined) ?? ''}
          onValueChange={onChange}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <JsonField id={id} field={field} value={value} onChange={onChange} />
      )}
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
    </div>
  );
}

function JsonField({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // Show pretty-printed JSON of the current structured value. We parse on every
  // change; invalid JSON is surfaced but does NOT clobber the last good value
  // (we just flag it — server validation is the real gate).
  const text = useMemo(() => {
    if (value === undefined) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }, [value]);

  const [draft, setDraft] = useState(text);
  const invalid = draft.trim() !== '' && !isParsable(draft);

  return (
    <>
      <Textarea
        id={id}
        rows={5}
        className="font-mono text-xs"
        defaultValue={text}
        placeholder={field.placeholder}
        onChange={e => {
          setDraft(e.target.value);
          const raw = e.target.value.trim();
          if (raw === '') {
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(raw));
          } catch {
            /* keep last valid value; flag below */
          }
        }}
      />
      {invalid ? (
        <p className="text-xs font-medium text-destructive">Invalid JSON — last valid value kept.</p>
      ) : null}
    </>
  );
}

function isParsable(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

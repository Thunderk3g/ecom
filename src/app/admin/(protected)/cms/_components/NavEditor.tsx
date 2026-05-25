'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Save, Loader2, ChevronUp, ChevronDown, CornerDownRight } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { saveMenuAction } from '../_lib/actions';
import type { NavSlot } from '@/modules/cms/navigation';

export type NavNode = { label: string; href?: string; children?: NavNode[] };

const SLOTS: { slot: NavSlot; label: string }[] = [
  { slot: 'header', label: 'Header' },
  { slot: 'footer', label: 'Footer' },
  { slot: 'mobile', label: 'Mobile' },
];

export function NavEditor({ menus }: { menus: Record<NavSlot, NavNode[]> }) {
  return (
    <Tabs defaultValue="header">
      <TabsList>
        {SLOTS.map(s => (
          <TabsTrigger key={s.slot} value={s.slot}>
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {SLOTS.map(s => (
        <TabsContent key={s.slot} value={s.slot} className="pt-4">
          <SlotEditor slot={s.slot} initial={menus[s.slot]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function SlotEditor({ slot, initial }: { slot: NavSlot; initial: NavNode[] }) {
  const router = useRouter();
  const [items, setItems] = useState<NavNode[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(next: NavNode[]) {
    setItems(next);
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      const res = await saveMenuAction(slot, items);
      if (res.ok) {
        toast.success('Menu saved.');
        setDirty(false);
        router.refresh();
      } else {
        toast.error(res.error ?? 'Save failed.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Edit the {slot} menu tree. Items without a link act as groups.
        </p>
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save menu
        </Button>
      </div>

      <NodeList nodes={items} onChange={update} depth={0} />

      <Button variant="outline" onClick={() => update([...items, { label: 'New item' }])}>
        <Plus className="mr-2 h-4 w-4" />
        Add top-level item
      </Button>
    </div>
  );
}

function NodeList({
  nodes,
  onChange,
  depth,
}: {
  nodes: NavNode[];
  onChange: (next: NavNode[]) => void;
  depth: number;
}) {
  function setNode(i: number, next: NavNode) {
    onChange(nodes.map((n, idx) => (idx === i ? next : n)));
  }
  function remove(i: number) {
    onChange(nodes.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return;
    const next = [...nodes];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    onChange(next);
  }

  if (nodes.length === 0) {
    return depth === 0 ? (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No items yet.
      </p>
    ) : null;
  }

  return (
    <ul className="space-y-3">
      {nodes.map((node, i) => (
        <li key={i} className="rounded-lg border bg-background p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Input
                value={node.label}
                onChange={e => setNode(i, { ...node, label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Link (optional)</Label>
              <Input
                value={node.href ?? ''}
                placeholder="/c/pens"
                onChange={e =>
                  setNode(i, { ...node, href: e.target.value === '' ? undefined : e.target.value })
                }
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === nodes.length - 1} aria-label="Move down">
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNode(i, { ...node, children: [...(node.children ?? []), { label: 'New child' }] })}
            >
              <CornerDownRight className="mr-1 h-4 w-4" />
              Add child
            </Button>
            <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove item">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
          {node.children && node.children.length > 0 ? (
            <div className="mt-3 border-l-2 pl-4">
              <NodeList
                nodes={node.children}
                depth={depth + 1}
                onChange={next =>
                  setNode(i, { ...node, children: next.length > 0 ? next : undefined })
                }
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

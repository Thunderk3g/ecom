'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Save,
  Loader2,
  Eye,
  Globe,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { BLOCK_KINDS, type BlockKind } from '@/modules/cms/blocks';
import { BLOCK_SPECS, defaultProps } from '../_lib/block-fields';
import { BlockFields } from './BlockFields';
import {
  publishPageAction,
  saveDraftAction,
  unpublishPageAction,
} from '../_lib/actions';

export type EditorBlock = { kind: BlockKind; props: Record<string, unknown> };

export interface BlockBuilderProps {
  pageId: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  initialBlocks: EditorBlock[];
  hasPublishedVersion: boolean;
  previewHref: string | null;
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type KeyedBlock = EditorBlock & { _id: string };

export function BlockBuilder(props: BlockBuilderProps) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<KeyedBlock[]>(
    props.initialBlocks.map(b => ({ ...b, _id: uid() })),
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  function mutate(next: KeyedBlock[]) {
    setBlocks(next);
    setDirty(true);
  }

  function addBlock(kind: BlockKind) {
    mutate([...blocks, { kind, props: defaultProps(kind), _id: uid() }]);
  }

  function removeBlock(id: string) {
    mutate(blocks.filter(b => b._id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const i = blocks.findIndex(b => b._id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    mutate(next);
  }

  function updateProps(id: string, propsNext: Record<string, unknown>) {
    mutate(blocks.map(b => (b._id === id ? { ...b, props: propsNext } : b)));
  }

  function save() {
    const payload = blocks.map(({ kind, props }) => ({ kind, props }));
    startTransition(async () => {
      const res = await saveDraftAction({ pageId: props.pageId, blocks: payload });
      if (res.ok) {
        toast.success('Draft saved.');
        setDirty(false);
        router.refresh();
      } else {
        toast.error(res.error ?? 'Save failed.');
      }
    });
  }

  function publish() {
    startTransition(async () => {
      const res = await publishPageAction(props.pageId);
      if (res.ok) {
        toast.success('Page published.');
        router.refresh();
      } else {
        toast.error(res.error ?? 'Publish failed.');
      }
    });
  }

  function unpublish() {
    startTransition(async () => {
      const res = await unpublishPageAction(props.pageId);
      if (res.ok) {
        toast.success('Page unpublished.');
        router.refresh();
      } else {
        toast.error(res.error ?? 'Unpublish failed.');
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
            <Badge variant={props.status === 'published' ? 'default' : 'secondary'} className="capitalize">
              {props.status}
            </Badge>
            {dirty ? <Badge variant="outline">Unsaved changes</Badge> : null}
          </div>
          <p className="text-muted-foreground">/{props.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.previewHref ? (
            <Button asChild variant="outline">
              <a href={props.previewHref} target="_blank" rel="noopener noreferrer">
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </a>
            </Button>
          ) : null}
          <Button variant="outline" onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save draft
          </Button>
          {props.hasPublishedVersion ? (
            <Button variant="outline" onClick={unpublish} disabled={pending}>
              <EyeOff className="mr-2 h-4 w-4" />
              Unpublish
            </Button>
          ) : null}
          <Button onClick={publish} disabled={pending}>
            <Globe className="mr-2 h-4 w-4" />
            Publish
          </Button>
        </div>
      </div>

      {dirty ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Save the draft before publishing — Publish promotes the last saved draft.
        </p>
      ) : null}

      <div className="space-y-4">
        {blocks.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            No blocks yet. Add one below.
          </div>
        ) : (
          blocks.map((block, idx) => (
            <div key={block._id} className="rounded-lg border bg-background">
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                <div>
                  <span className="text-sm font-semibold">{BLOCK_SPECS[block.kind].label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {BLOCK_SPECS[block.kind].description}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => move(block._id, -1)} disabled={idx === 0} aria-label="Move up">
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => move(block._id, 1)} disabled={idx === blocks.length - 1} aria-label="Move down">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => removeBlock(block._id)} aria-label="Remove block">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="p-4">
                <BlockFields
                  kind={block.kind}
                  props={block.props}
                  onChange={next => updateProps(block._id, next)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            Add block
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {BLOCK_KINDS.map(kind => (
            <DropdownMenuItem key={kind} onSelect={() => addBlock(kind)}>
              {BLOCK_SPECS[kind].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

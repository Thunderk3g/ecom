'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createPageAction } from '../_lib/actions';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function CreatePageDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createPageAction({ slug, title });
      if (res.ok && res.pageId) {
        toast.success('Page created.');
        setOpen(false);
        setTitle('');
        setSlug('');
        setSlugEdited(false);
        router.push(`/admin/cms/pages/${res.pageId}` as `/admin/cms/pages/${string}`);
      } else {
        toast.error(res.error ?? 'Could not create page.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New page
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create page</DialogTitle>
          <DialogDescription>Pages start as a draft. Publish when ready.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cms-title">Title</Label>
            <Input
              id="cms-title"
              value={title}
              onChange={e => {
                setTitle(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
              placeholder="About us"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cms-slug">Slug</Label>
            <Input
              id="cms-slug"
              value={slug}
              onChange={e => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              placeholder="about-us"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim() || !slug.trim()}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

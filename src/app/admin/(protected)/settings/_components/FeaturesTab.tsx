'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { updateSiteConfigAction } from '../actions';

export type FeaturesTabProps = {
  initial: Record<string, boolean>;
};

// Human labels for the well-known feature keys; unknown keys fall back to the
// raw key. Keeping this map in the component (not actions.ts) keeps the
// validator free-form: admins can add custom feature flags too.
const KNOWN_LABELS: Record<string, { label: string; description: string }> = {
  wishlist: {
    label: 'Wishlist',
    description: 'Lets logged-in customers save products for later.',
  },
  reviews: {
    label: 'Product reviews',
    description: 'Enables review submission and aggregated ratings on PDPs.',
  },
  guestCheckout: {
    label: 'Guest checkout',
    description: 'Allow checkout without an account. Recommended on.',
  },
  b2bPricing: {
    label: 'B2B pricing',
    description: 'Show tiered/customer-group pricing when logged in.',
  },
};

export function FeaturesTab({ initial }: FeaturesTabProps) {
  const [pending, startTransition] = useTransition();
  const [features, setFeatures] = useState<Record<string, boolean>>(initial);
  const [draftKey, setDraftKey] = useState('');
  const [dirty, setDirty] = useState(false);

  function toggle(key: string) {
    setFeatures(prev => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
  }

  function addCustom() {
    const k = draftKey.trim();
    if (!k) return;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) {
      toast.error('Use a short identifier: letters, digits, underscores');
      return;
    }
    if (k in features) {
      toast.error('Feature already exists');
      return;
    }
    setFeatures(prev => ({ ...prev, [k]: false }));
    setDraftKey('');
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      const res = await updateSiteConfigAction({ features });
      if (res.ok) {
        toast.success('Features updated');
        setDirty(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  const entries = Object.entries(features).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>
          Toggle feature flags backed by <code className="text-xs">site_config.features</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-md border">
          {entries.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No feature flags yet.</div>
          ) : (
            entries.map(([key, enabled]) => {
              const meta = KNOWN_LABELS[key];
              return (
                <div key={key} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="font-medium">{meta?.label ?? key}</div>
                    <div className="text-xs text-muted-foreground">
                      {meta?.description ?? `Custom flag: ${key}`}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={enabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggle(key)}
                    aria-pressed={enabled}
                  >
                    {enabled ? 'On' : 'Off'}
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="newFeatureKey">Add a custom feature flag</Label>
          <div className="flex gap-2">
            <Input
              id="newFeatureKey"
              placeholder="featureKey"
              value={draftKey}
              onChange={e => setDraftKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addCustom}>
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            New flags start disabled. Removing a flag is not supported from the UI yet — set it to{' '}
            <em>Off</em> instead.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save features'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

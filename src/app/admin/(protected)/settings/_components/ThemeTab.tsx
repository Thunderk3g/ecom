'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { updateSiteConfigAction } from '../actions';

const colorHex = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/u, 'must be a #rgb or #rrggbb color');

const themeFormSchema = z.object({
  primary: colorHex,
  secondary: colorHex,
  sans: z.string().min(1).max(80),
  serif: z.string().min(1).max(80),
  spacingScale: z.enum(['sm', 'md', 'lg']),
  radius: z.string().min(1).max(20),
});

type ThemeFormValues = z.infer<typeof themeFormSchema>;

export type ThemeTabProps = {
  initial: ThemeFormValues;
};

const FONT_PRESETS = ['Inter', 'Source Serif', 'system-ui', 'custom'] as const;
const RADIUS_OPTIONS = ['0px', '4px', '6px', '8px', '12px', '16px'] as const;

// Mapping from the friendly t-shirt scale to the numeric multiplier persisted
// in site_config.theme.spacingScale.
const SPACING_VALUES: Record<'sm' | 'md' | 'lg', number> = {
  sm: 0.875,
  md: 1.0,
  lg: 1.25,
};

export function scaleToSize(scale: number): 'sm' | 'md' | 'lg' {
  if (scale <= 0.95) return 'sm';
  if (scale >= 1.1) return 'lg';
  return 'md';
}

export function ThemeTab({ initial }: ThemeTabProps) {
  const [pending, startTransition] = useTransition();
  const form = useForm<ThemeFormValues>({
    resolver: zodResolver(themeFormSchema),
    defaultValues: initial,
  });

  const primary = form.watch('primary');
  const secondary = form.watch('secondary');
  const sans = form.watch('sans');
  const serif = form.watch('serif');
  const radius = form.watch('radius');

  function onSubmit(values: ThemeFormValues) {
    startTransition(async () => {
      const res = await updateSiteConfigAction({
        theme: {
          color: {
            primary: values.primary,
            secondary: values.secondary,
          },
          type: {
            sans: values.sans,
            serif: values.serif,
          },
          radius: values.radius,
          spacingScale: SPACING_VALUES[values.spacingScale],
        },
      });
      if (res.ok) {
        toast.success('Theme updated');
        form.reset(values);
      } else {
        toast.error(res.error);
      }
    });
  }

  // Font selector: free-text Input when the user picks "custom"; otherwise
  // a Select that writes one of the preset families.
  const sansIsCustom = !FONT_PRESETS.slice(0, 3).includes(sans as typeof FONT_PRESETS[number]);
  const serifIsCustom = !FONT_PRESETS.slice(0, 3).includes(serif as typeof FONT_PRESETS[number]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          Color tokens, fonts, spacing, and radius. Saved values are injected into the
          storefront via CSS custom properties.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Colors */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Colors</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="primary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                            className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
                            aria-label="Primary color picker"
                          />
                          <Input
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                            placeholder="#2C3E8C"
                            className="flex-1"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secondary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Accent</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                            className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
                            aria-label="Accent color picker"
                          />
                          <Input
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                            placeholder="#F2994A"
                            className="flex-1"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Optional live swatch preview */}
              <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
                <div
                  className="h-10 w-10 rounded-md border"
                  style={{ backgroundColor: primary, borderRadius: radius }}
                  aria-label="Primary swatch"
                />
                <div
                  className="h-10 w-10 rounded-md border"
                  style={{ backgroundColor: secondary, borderRadius: radius }}
                  aria-label="Accent swatch"
                />
                <span
                  className="text-sm"
                  style={{ fontFamily: sans }}
                >
                  Sans preview · The quick brown fox
                </span>
                <span
                  className="text-sm italic"
                  style={{ fontFamily: serif }}
                >
                  Serif preview
                </span>
              </div>
            </div>

            <Separator />

            {/* Typography */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Typography</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="sans"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sans font</FormLabel>
                      <Select
                        value={sansIsCustom ? 'custom' : field.value}
                        onValueChange={v => field.onChange(v === 'custom' ? '' : v)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Inter">Inter</SelectItem>
                          <SelectItem value="Source Serif">Source Serif</SelectItem>
                          <SelectItem value="system-ui">System UI</SelectItem>
                          <SelectItem value="custom">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {sansIsCustom ? (
                        <FormControl>
                          <Input
                            placeholder="Custom font family"
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                          />
                        </FormControl>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="serif"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serif font</FormLabel>
                      <Select
                        value={serifIsCustom ? 'custom' : field.value}
                        onValueChange={v => field.onChange(v === 'custom' ? '' : v)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Inter">Inter</SelectItem>
                          <SelectItem value="Source Serif">Source Serif</SelectItem>
                          <SelectItem value="system-ui">System UI</SelectItem>
                          <SelectItem value="custom">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {serifIsCustom ? (
                        <FormControl>
                          <Input
                            placeholder="Custom font family"
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                          />
                        </FormControl>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Spacing + radius */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Spacing & radius</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="spacingScale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Spacing scale</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="sm">Compact (sm)</SelectItem>
                          <SelectItem value="md">Comfortable (md)</SelectItem>
                          <SelectItem value="lg">Roomy (lg)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>Multiplier applied to layout spacing.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="radius"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Border radius</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RADIUS_OPTIONS.map(r => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !form.formState.isDirty}>
                {pending ? 'Saving…' : 'Save theme'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

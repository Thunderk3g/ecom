'use client';

import { useState, useTransition } from 'react';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { updateSiteConfigAction } from '../actions';

const localeRe = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u;

const formSchema = z.object({
  currencyCode: z
    .string()
    .length(3, 'ISO 4217 code is exactly 3 letters')
    .regex(/^[A-Z]{3}$/u, 'Use uppercase letters (e.g. INR, USD)'),
  currencySymbol: z.string().min(1).max(4),
  defaultLocale: z.string().regex(localeRe, 'BCP 47 tag, e.g. en-IN'),
  supportedLocales: z.array(z.string().regex(localeRe)).min(1, 'At least one locale'),
});

type FormValues = z.infer<typeof formSchema>;

export type CurrencyLocaleTabProps = {
  initial: FormValues;
};

export function CurrencyLocaleTab({ initial }: CurrencyLocaleTabProps) {
  const [pending, startTransition] = useTransition();
  const [draftLocale, setDraftLocale] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial,
  });

  const supported = form.watch('supportedLocales');
  const defaultLocale = form.watch('defaultLocale');

  function addLocale() {
    const trimmed = draftLocale.trim();
    if (!trimmed) return;
    if (!localeRe.test(trimmed)) {
      toast.error('Invalid locale tag (use BCP 47, e.g. en-IN)');
      return;
    }
    if (supported.includes(trimmed)) {
      toast.error('Locale already in the list');
      return;
    }
    form.setValue('supportedLocales', [...supported, trimmed], {
      shouldDirty: true,
      shouldValidate: true,
    });
    setDraftLocale('');
  }

  function removeLocale(tag: string) {
    if (tag === defaultLocale) {
      toast.error('Cannot remove the default locale');
      return;
    }
    form.setValue(
      'supportedLocales',
      supported.filter(t => t !== tag),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function onSubmit(values: FormValues) {
    if (!values.supportedLocales.includes(values.defaultLocale)) {
      form.setError('defaultLocale', {
        message: 'Default locale must be in the supported list',
      });
      return;
    }
    startTransition(async () => {
      const res = await updateSiteConfigAction({
        currency: {
          code: values.currencyCode,
          symbol: values.currencySymbol,
        },
        locale: {
          default: values.defaultLocale,
          supported: values.supportedLocales,
        },
      });
      if (res.ok) {
        toast.success('Currency & locale updated');
        form.reset(values);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currency & locale</CardTitle>
        <CardDescription>
          Pricing currency and supported locales for the storefront.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Currency</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="currencyCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="INR"
                          maxLength={3}
                          {...field}
                          onChange={e => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currencySymbol"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Symbol</FormLabel>
                      <FormControl>
                        <Input placeholder="₹" maxLength={4} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Locales</h3>
              <FormField
                control={form.control}
                name="defaultLocale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default locale</FormLabel>
                    <FormControl>
                      <Input placeholder="en-IN" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="supportedLocales"
                render={() => (
                  <FormItem>
                    <FormLabel>Supported locales</FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {supported.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No locales configured.</p>
                      ) : (
                        supported.map(tag => (
                          <Badge
                            key={tag}
                            variant={tag === defaultLocale ? 'default' : 'secondary'}
                            className="gap-2"
                          >
                            <span>{tag}</span>
                            {tag === defaultLocale ? (
                              <span className="text-[10px] uppercase opacity-80">default</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => removeLocale(tag)}
                                className="text-xs opacity-70 hover:opacity-100"
                                aria-label={`Remove ${tag}`}
                              >
                                ×
                              </button>
                            )}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Input
                        placeholder="Add locale e.g. en-GB"
                        value={draftLocale}
                        onChange={e => setDraftLocale(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addLocale();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" onClick={addLocale}>
                        Add
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !form.formState.isDirty}>
                {pending ? 'Saving…' : 'Save currency & locale'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

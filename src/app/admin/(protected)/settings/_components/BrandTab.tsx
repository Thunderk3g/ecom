'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { updateSiteConfigAction } from '../actions';

const brandFormSchema = z.object({
  name: z.string().min(1, 'Required').max(120),
  tagline: z.string().max(240),
  logoAssetId: z.string().max(120),
  supportEmail: z.string().email('Invalid email').or(z.literal('')),
  supportPhone: z.string().max(40),
});

type BrandFormValues = z.infer<typeof brandFormSchema>;

export type BrandTabProps = {
  initial: BrandFormValues;
};

export function BrandTab({ initial }: BrandTabProps) {
  const [pending, startTransition] = useTransition();
  const form = useForm<BrandFormValues>({
    resolver: zodResolver(brandFormSchema),
    defaultValues: initial,
  });

  function onSubmit(values: BrandFormValues) {
    startTransition(async () => {
      const res = await updateSiteConfigAction({
        brand: {
          name: values.name,
          tagline: values.tagline,
          logoAssetId: values.logoAssetId,
          supportEmail: values.supportEmail,
          supportPhone: values.supportPhone,
        },
      });
      if (res.ok) {
        toast.success('Brand updated');
        form.reset(values);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand</CardTitle>
        <CardDescription>Identity shown across the storefront and emails.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store name</FormLabel>
                    <FormControl>
                      <Input placeholder="Inkwell & Co" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tagline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tagline</FormLabel>
                    <FormControl>
                      <Input placeholder="Paper goods, properly." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="logoAssetId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo asset ID</FormLabel>
                  <FormControl>
                    <Input placeholder="asset_xxx" {...field} />
                  </FormControl>
                  <FormDescription>
                    Reference to an uploaded asset (SP-8). Leave empty to use the default mark.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="supportEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Support email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="hello@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supportPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Support phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+91 80000 00000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !form.formState.isDirty}>
                {pending ? 'Saving…' : 'Save brand'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

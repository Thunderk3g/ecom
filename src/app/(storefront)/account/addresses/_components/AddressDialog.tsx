'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createAddressAction,
  updateAddressAction,
  type CreateAddressFormInput,
  type UpdateAddressFormInput,
} from '../../actions';

/**
 * Create-or-edit dialog for a single saved address.
 *
 * Both modes share the same zod schema; on submit we dispatch to the
 * appropriate Server Action. The action result is a tagged union
 * (`{ ok: true } | { ok: false; error }`) — failures surface via Sonner toast,
 * successes close the dialog and revalidate the addresses route.
 *
 * `useTransition` keeps the dialog responsive (and shows a disabled state on
 * the submit button) while the action is in flight.
 */

const formSchema = z.object({
  type: z.enum(['billing', 'shipping', 'both']),
  name: z.string().min(1, 'Required'),
  line1: z.string().min(1, 'Required'),
  line2: z.string().optional(),
  city: z.string().min(1, 'Required'),
  region: z.string().min(1, 'Required'),
  postal: z.string().min(1, 'Required'),
  country: z.string().min(2, 'Use a 2-letter country code'),
  phone: z.string().optional(),
  isDefault: z.boolean().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export type AddressDialogInitialValues = {
  id?: string;
  type: 'billing' | 'shipping' | 'both';
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone?: string | null;
  isDefault?: boolean;
};

const DEFAULT_VALUES: FormValues = {
  type: 'shipping',
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal: '',
  country: 'IN',
  phone: '',
  isDefault: false,
};

export function AddressDialog({
  mode,
  initial,
  trigger,
}: {
  mode: 'create' | 'edit';
  initial?: AddressDialogInitialValues;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const defaultValues: FormValues = initial
    ? {
        type: initial.type,
        name: initial.name,
        line1: initial.line1,
        line2: initial.line2 ?? '',
        city: initial.city,
        region: initial.region,
        postal: initial.postal,
        country: initial.country,
        phone: initial.phone ?? '',
        isDefault: initial.isDefault ?? false,
      }
    : DEFAULT_VALUES;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  function onOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      form.reset(defaultValues);
    }
  }

  function onSubmit(values: FormValues): void {
    startTransition(async () => {
      if (mode === 'create') {
        const payload: CreateAddressFormInput = {
          type: values.type,
          name: values.name,
          line1: values.line1,
          ...(values.line2 ? { line2: values.line2 } : {}),
          city: values.city,
          region: values.region,
          postal: values.postal,
          country: values.country,
          ...(values.phone ? { phone: values.phone } : {}),
          ...(values.isDefault !== undefined
            ? { isDefault: values.isDefault }
            : {}),
        };
        const result = await createAddressAction(payload);
        if (result.ok) {
          toast.success('Address added');
          setOpen(false);
        } else {
          toast.error(result.error);
        }
        return;
      }

      // Edit mode — `initial.id` must be present.
      if (!initial?.id) {
        toast.error('Missing address id');
        return;
      }
      const patch: UpdateAddressFormInput = {
        type: values.type,
        name: values.name,
        line1: values.line1,
        line2: values.line2 ? values.line2 : null,
        city: values.city,
        region: values.region,
        postal: values.postal,
        country: values.country,
        phone: values.phone ? values.phone : null,
      };
      const result = await updateAddressAction(initial.id, patch);
      if (result.ok) {
        toast.success('Address updated');
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Add address' : 'Edit address'}
          </DialogTitle>
          <DialogDescription>
            Saved addresses appear at checkout for faster ordering.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={value =>
                        field.onChange(value as FormValues['type'])
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="shipping">Shipping</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="line1"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Address line 1</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="line2"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Address line 2</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State / Region</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="postal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postal code</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {mode === 'create' ? (
                <FormField
                  control={form.control}
                  name="isDefault"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2 flex items-center gap-2 space-y-0">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={field.value ?? false}
                          onChange={e => field.onChange(e.target.checked)}
                        />
                      </FormControl>
                      <FormLabel className="!mt-0">
                        Set as default for this type
                      </FormLabel>
                    </FormItem>
                  )}
                />
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : mode === 'create'
                    ? 'Add address'
                    : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

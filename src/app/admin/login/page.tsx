'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      setError(
        res.status === 401
          ? 'Invalid email or password.'
          : 'Sign in failed. Please try again.',
      );
      return;
    }

    router.push('/admin' as Parameters<typeof router.push>[0]);
    router.refresh();
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: 'var(--paper-2)' }}
    >
      <div className="surface pad" style={{ width: '100%', maxWidth: 400 }}>
        <div className="stack" style={{ gap: 4, marginBottom: 22 }}>
          <span
            className="logo"
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 30,
              letterSpacing: '.18em',
              textIndent: '.18em',
            }}
          >
            Plume
          </span>
          <span className="eyebrow muted">Admin</span>
          <p className="t-sub" style={{ marginTop: 2 }}>
            Enter your credentials to access the dashboard.
          </p>
        </div>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="stack"
            style={{ gap: 16 }}
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="field">
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@store.com"
                      className="input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem className="field">
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <input
                      type="password"
                      autoComplete="current-password"
                      className="input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error ? (
              <p className="text-sm font-medium" style={{ color: 'var(--sale)' }}>
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn btn-clay btn-block"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Form>
      </div>
    </div>
  );
}

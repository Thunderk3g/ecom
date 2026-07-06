'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';

/**
 * Lightweight storefront toast system — no dependencies, module-level store.
 *
 * `toast({ title, description?, action?, duration? })` can be called from any
 * client module (it is a plain function, not a hook); `useToast()` returns the
 * same functions for components that prefer hook ergonomics. `<Toaster />` is
 * mounted once by `AppShell` and renders the stack bottom-right with
 * slide-in/out, a progress indicator, auto-dismiss (default 4s) and
 * pause-on-hover.
 */

export type ToastAction = { label: string; onClick: () => void };

export type ToastOptions = {
  title: string;
  description?: string;
  action?: ToastAction;
  /** Auto-dismiss delay in ms (default 4000). */
  duration?: number;
};

type ToastItem = ToastOptions & {
  id: string;
  duration: number;
  leaving: boolean;
};

const EXIT_MS = 240;
const MAX_VISIBLE = 4;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastItem[] {
  return items;
}

const EMPTY: ToastItem[] = [];
function getServerSnapshot(): ToastItem[] {
  return EMPTY;
}

function remove(id: string): void {
  items = items.filter(t => t.id !== id);
  emit();
}

/** Begin a toast's exit animation, then remove it from the store. */
export function dismissToast(id: string): void {
  const target = items.find(t => t.id === id);
  if (!target || target.leaving) return;
  items = items.map(t => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  window.setTimeout(() => remove(id), EXIT_MS);
}

/** Show a toast. Returns the toast id (usable with `dismissToast`). */
export function toast(options: ToastOptions): string {
  const id = `t${++seq}`;
  const item: ToastItem = {
    ...options,
    id,
    duration: options.duration ?? 4000,
    leaving: false,
  };
  items = [...items, item];
  // Cap the stack: start dismissing the oldest when over budget.
  const active = items.filter(t => !t.leaving);
  if (active.length > MAX_VISIBLE) {
    const oldest = active[0];
    if (oldest) dismissToast(oldest.id);
  }
  emit();
  return id;
}

/** Hook ergonomics over the module-level `toast`/`dismissToast`. */
export function useToast(): { toast: typeof toast; dismiss: typeof dismissToast } {
  return useMemo(() => ({ toast, dismiss: dismissToast }), []);
}

function ToastCard({ item }: { item: ToastItem }) {
  const remainingRef = useRef(item.duration);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  // Auto-dismiss timer with pause-on-hover (the CSS progress bar pauses via
  // animation-play-state; the JS timer mirrors it by tracking remaining time).
  useEffect(() => {
    if (item.leaving) return;
    const start = (): void => {
      startedAtRef.current = Date.now();
      timerRef.current = window.setTimeout(() => dismissToast(item.id), remainingRef.current);
    };
    start();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [item.id, item.leaving]);

  const pause = (): void => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(400, remainingRef.current - (Date.now() - startedAtRef.current));
  };

  const resume = (): void => {
    if (item.leaving || timerRef.current !== null) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => dismissToast(item.id), remainingRef.current);
  };

  return (
    <div
      className={item.leaving ? 'tst leaving' : 'tst'}
      style={{ '--tst-duration': `${item.duration}ms` } as React.CSSProperties}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      <div className="tst-row">
        <div className="tst-body">
          <div className="tst-title">{item.title}</div>
          {item.description ? <p className="tst-desc">{item.description}</p> : null}
        </div>
        {item.action ? (
          <button
            type="button"
            className="tst-action"
            onClick={() => {
              item.action?.onClick();
              dismissToast(item.id);
            }}
          >
            {item.action.label}
          </button>
        ) : null}
        <button
          type="button"
          className="tst-x"
          onClick={() => dismissToast(item.id)}
          aria-label="Dismiss notification"
        >
          <X aria-hidden />
        </button>
      </div>
      <div className="tst-progress" aria-hidden="true" />
    </div>
  );
}

/** Toast stack renderer — mount exactly once (AppShell does). */
export function Toaster() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div className="tst-stack" role="status" aria-live="polite" aria-label="Notifications">
      {current.map(item => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}

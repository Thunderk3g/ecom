'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ensureStorefrontSession } from '@/app/(storefront)/_lib/session';

/**
 * Client cart context.
 *
 * Talks exclusively to the existing storefront cart HTTP API
 * (`/api/v1/cart/*`) with `credentials: 'include'` so the http-only cart_sid /
 * sid cookies ride along. CSRF + Idempotency-Key + session cookies are all
 * handled there — this context never touches the DB or module layer directly.
 *
 * The CSRF token is obtained from the `ensureStorefrontSession` server action
 * (it is bound to the same session id the API verifies against; see
 * _lib/session.ts). The cart id is persisted in localStorage so the cart
 * survives reloads; it is lazily (re)created on the first mutation.
 */

// Minimal mirrors of the server payload shapes we render against.
export type CartLine = {
  itemId: string;
  variantId: string;
  qty: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  lineDiscountCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
};

export type CartTotals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  lines: CartLine[];
  appliedPromotions: { code?: string; label?: string; amountCents: number; freeShipping?: boolean }[];
  shippingOption?: { code: string; label: string };
};

export type CartItem = {
  id: string;
  variantId: string;
  qty: number;
  unitPriceCents: number;
};

export type Cart = {
  id: string;
  currency: string;
  couponCode: string | null;
  items: CartItem[];
};

export type CartState = {
  cart: Cart | null;
  totals: CartTotals | null;
  /** Total item quantity, for the header badge. */
  count: number;
  loading: boolean;
  error: string | null;
};

export type CartContextValue = CartState & {
  ready: boolean;
  refresh: () => Promise<void>;
  addItem: (variantId: string, qty?: number) => Promise<boolean>;
  updateItem: (itemId: string, qty: number) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<boolean>;
  applyCoupon: (code: string) => Promise<boolean>;
  removeCoupon: () => Promise<boolean>;
};

const CART_ID_KEY = 'storefront.cartId';

const CartContext = createContext<CartContextValue | null>(null);

type ApiCartPayload = { cart: Cart; totals: CartTotals };

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>({
    cart: null,
    totals: null,
    count: 0,
    loading: false,
    error: null,
  });
  const [ready, setReady] = useState(false);
  const csrfRef = useRef<string | null>(null);
  const cartIdRef = useRef<string | null>(null);

  const countFrom = (cart: Cart | null): number =>
    cart ? cart.items.reduce((sum, it) => sum + it.qty, 0) : 0;

  const applyPayload = useCallback((payload: ApiCartPayload) => {
    cartIdRef.current = payload.cart.id;
    try {
      window.localStorage.setItem(CART_ID_KEY, payload.cart.id);
    } catch {
      /* localStorage unavailable (private mode) — keep in-memory only */
    }
    setState({
      cart: payload.cart,
      totals: payload.totals,
      count: countFrom(payload.cart),
      loading: false,
      error: null,
    });
  }, []);

  const ensureCsrf = useCallback(async (): Promise<string> => {
    if (csrfRef.current) return csrfRef.current;
    const session = await ensureStorefrontSession();
    csrfRef.current = session.csrfToken;
    return session.csrfToken;
  }, []);

  /** POST /api/v1/cart — create a cart and capture its id. */
  const createCart = useCallback(async (): Promise<string | null> => {
    const csrf = await ensureCsrf();
    const res = await fetch('/api/v1/cart', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'idempotency-key': newIdempotencyKey(),
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: ApiCartPayload };
    applyPayload(json.data);
    return json.data.cart.id;
  }, [ensureCsrf, applyPayload]);

  const getOrCreateCartId = useCallback(async (): Promise<string | null> => {
    if (cartIdRef.current) return cartIdRef.current;
    return createCart();
  }, [createCart]);

  const refresh = useCallback(async () => {
    const id = cartIdRef.current;
    if (!id) return;
    setState(s => ({ ...s, loading: true }));
    const res = await fetch(`/api/v1/cart/${id}`, { credentials: 'include' });
    if (res.ok) {
      const json = (await res.json()) as { data: ApiCartPayload };
      applyPayload(json.data);
    } else if (res.status === 404) {
      // Stale cart id (expired/cleared) — drop it so the next mutation recreates.
      cartIdRef.current = null;
      try {
        window.localStorage.removeItem(CART_ID_KEY);
      } catch {
        /* ignore */
      }
      setState({ cart: null, totals: null, count: 0, loading: false, error: null });
    } else {
      setState(s => ({ ...s, loading: false }));
    }
  }, [applyPayload]);

  // Bootstrap: recover the cart id from localStorage and hydrate it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = window.localStorage.getItem(CART_ID_KEY);
        if (stored) cartIdRef.current = stored;
      } catch {
        /* ignore */
      }
      if (cartIdRef.current && !cancelled) {
        await refresh();
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /** Shared mutation runner: resolves cart id + csrf, runs the call, applies result. */
  const mutate = useCallback(
    async (
      run: (cartId: string, csrf: string) => Promise<Response>,
    ): Promise<boolean> => {
      setState(s => ({ ...s, loading: true, error: null }));
      const cartId = await getOrCreateCartId();
      if (!cartId) {
        setState(s => ({ ...s, loading: false, error: 'Could not initialise cart' }));
        return false;
      }
      const csrf = await ensureCsrf();
      const res = await run(cartId, csrf);
      if (res.ok) {
        const json = (await res.json()) as { data: ApiCartPayload };
        applyPayload(json.data);
        return true;
      }
      let detail = 'Something went wrong';
      try {
        const body = (await res.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        /* non-JSON error body */
      }
      setState(s => ({ ...s, loading: false, error: detail }));
      return false;
    },
    [getOrCreateCartId, ensureCsrf, applyPayload],
  );

  const addItem = useCallback(
    (variantId: string, qty = 1) =>
      mutate((cartId, csrf) =>
        fetch(`/api/v1/cart/${cartId}/items`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            'idempotency-key': newIdempotencyKey(),
          },
          body: JSON.stringify({ variantId, qty }),
        }),
      ),
    [mutate],
  );

  const updateItem = useCallback(
    (itemId: string, qty: number) =>
      mutate((cartId, csrf) =>
        fetch(`/api/v1/cart/${cartId}/items/${itemId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            'idempotency-key': newIdempotencyKey(),
          },
          body: JSON.stringify({ qty }),
        }),
      ),
    [mutate],
  );

  const removeItem = useCallback(
    (itemId: string) =>
      mutate((cartId, csrf) =>
        fetch(`/api/v1/cart/${cartId}/items/${itemId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'x-csrf-token': csrf,
            'idempotency-key': newIdempotencyKey(),
          },
        }),
      ),
    [mutate],
  );

  const applyCoupon = useCallback(
    (code: string) =>
      mutate((cartId, csrf) =>
        fetch(`/api/v1/cart/${cartId}/coupon`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            'idempotency-key': newIdempotencyKey(),
          },
          body: JSON.stringify({ code }),
        }),
      ),
    [mutate],
  );

  const removeCoupon = useCallback(
    () =>
      mutate((cartId, csrf) =>
        fetch(`/api/v1/cart/${cartId}/coupon`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'x-csrf-token': csrf,
            'idempotency-key': newIdempotencyKey(),
          },
        }),
      ),
    [mutate],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      ready,
      refresh,
      addItem,
      updateItem,
      removeItem,
      applyCoupon,
      removeCoupon,
    }),
    [state, ready, refresh, addItem, updateItem, removeItem, applyCoupon, removeCoupon],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a <CartProvider>');
  return ctx;
}

/** Read the persisted cart id (client only) — used by the checkout flow. */
export function readPersistedCartId(): string | null {
  try {
    return window.localStorage.getItem(CART_ID_KEY);
  } catch {
    return null;
  }
}

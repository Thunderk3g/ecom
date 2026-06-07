import Link from 'next/link';

/**
 * Shared `/account/*` sidebar navigation (Plume `.acct-nav`).
 *
 * Server component — the sign-out control posts the `logoutAction` Server
 * Action passed by the page, so no client JS is needed. `current` highlights
 * the active link with the Plume `.on` class.
 */
type Props = {
  current: 'overview' | 'orders' | 'addresses';
  logoutAction?: () => Promise<void>;
};

export function AccountNav({ current, logoutAction }: Props) {
  return (
    <aside className="acct-nav">
      <Link href="/account" className={current === 'overview' ? 'on' : undefined}>
        ⌂ Overview
      </Link>
      <Link href="/account/orders" className={current === 'orders' ? 'on' : undefined}>
        ❑ Orders
      </Link>
      <Link
        href="/account/addresses"
        className={current === 'addresses' ? 'on' : undefined}
      >
        ⌖ Addresses
      </Link>
      <div className="sep" />
      <Link href="/">→ Back to shop</Link>
      {logoutAction ? (
        <form action={logoutAction} style={{ display: 'contents' }}>
          <button
            type="submit"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '11px',
              padding: '11px 14px',
              borderRadius: 'var(--r-sm)',
              fontSize: '14px',
              color: 'var(--ink-2)',
              fontWeight: 500,
              background: 'none',
              border: 0,
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            ⏻ Sign out
          </button>
        </form>
      ) : null}
    </aside>
  );
}

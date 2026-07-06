'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Storefront chrome overlay state: search overlay + mobile menu.
 * (Cart drawer state lives in the cart context so add-to-cart can open it.)
 *
 * Also binds Ctrl/Cmd+K to toggle the search overlay. Mounted once by
 * `AppShell`; any client island inside the shell can call `useChrome()`.
 */
export type ChromeContextValue = {
  searchOpen: boolean;
  mobileOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  openMobileMenu: () => void;
  closeMobileMenu: () => void;
};

const ChromeContext = createContext<ChromeContextValue | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setMobileOpen(false);
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openMobileMenu = useCallback(() => {
    setMobileOpen(true);
    setSearchOpen(false);
  }, []);
  const closeMobileMenu = useCallback(() => setMobileOpen(false), []);

  // Global Ctrl/Cmd+K → toggle search overlay.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(v => !v);
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo<ChromeContextValue>(
    () => ({
      searchOpen,
      mobileOpen,
      openSearch,
      closeSearch,
      openMobileMenu,
      closeMobileMenu,
    }),
    [searchOpen, mobileOpen, openSearch, closeSearch, openMobileMenu, closeMobileMenu],
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeContextValue {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error('useChrome must be used within a <ChromeProvider>');
  return ctx;
}

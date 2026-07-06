/**
 * Storefront chrome overlays & header islands. All client components; the
 * server `AppShell` composes them. See ../motion/README.md for the full
 * public API (including the CSS classes these rely on in
 * src/styles/chrome.css).
 */
export { ChromeProvider, useChrome, type ChromeContextValue } from './chrome-context';
export { StickyHeader } from './StickyHeader';
export { MegaNav } from './MegaNav';
export { CartButton } from './CartButton';
export { SearchTrigger } from './SearchTrigger';
export { CartDrawer } from './CartDrawer';
export { SearchOverlay } from './SearchOverlay';
export { MobileMenu, MobileMenuTrigger } from './MobileMenu';
export { Toaster, toast, dismissToast, useToast, type ToastOptions, type ToastAction } from './Toaster';
export { NewsletterForm } from './NewsletterForm';
export { useOverlay, formatMinor, type UseOverlayOptions } from './overlay-utils';

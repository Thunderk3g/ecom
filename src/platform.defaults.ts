export const platformDefaults = {
  brand: { name: 'Stationery Store', tagline: 'Paper goods, properly.' },
  theme: {
    color: { bg: '#FAF6EE', fg: '#1A1A2E', primary: '#2C3E8C', secondary: '#F2994A' },
    type: { sans: 'Inter', serif: 'Source Serif' },
    radius: '6px',
    spacingScale: 1.0,
  },
  locale: { default: 'en-IN', supported: ['en-IN', 'en-GB'] },
  currency: { code: 'INR', symbol: '₹', rounding: '0.50' },
  payments: { providers: ['razorpay', 'stripe'], default: 'razorpay' },
  features: { wishlist: false, reviews: false, guestCheckout: true, b2bPricing: false },
} as const;

export type SiteConfig = typeof platformDefaults & Record<string, unknown>;

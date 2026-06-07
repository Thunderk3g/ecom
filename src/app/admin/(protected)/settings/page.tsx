import { getAdminContext } from '../_lib/context';
import { loadSiteConfig } from '@/modules/config/loader';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

import { BrandTab } from './_components/BrandTab';
import { ThemeTab } from './_components/ThemeTab';
import { scaleToSize } from './_components/spacing';
import { CurrencyLocaleTab } from './_components/CurrencyLocaleTab';
import { FeaturesTab } from './_components/FeaturesTab';

export const dynamic = 'force-dynamic';

// Narrow helpers — the persisted config is intentionally typed as
// `SiteConfig & Record<string, unknown>`, so brand-extension fields like
// `logoAssetId` / `supportEmail` come back as `unknown`. These coercions
// keep the form's defaultValues strictly typed.
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// Plume `.adm-tabs a` look for the shadcn TabsTrigger: quiet tab that gets a
// clay underline when active (data-state="active").
const TAB_CLASS =
  'rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 py-3 text-[13.5px] font-semibold text-[var(--ink-3)] shadow-none data-[state=active]:border-[var(--clay)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--ink)] data-[state=active]:shadow-none';

export default async function SettingsPage() {
  const { storeId } = await getAdminContext();
  const cfg = await loadSiteConfig(storeId);

  const brandRecord = cfg.brand as Record<string, unknown>;
  const features =
    cfg.features && typeof cfg.features === 'object'
      ? Object.fromEntries(
          Object.entries(cfg.features as Record<string, unknown>).map(
            ([k, v]) => [k, Boolean(v)] as const,
          ),
        )
      : {};

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Settings
          </h2>
          <span className="t-sub">
            Brand, theme, currency, locales, and feature flags for this store.
          </span>
        </div>
      </div>

      <Tabs defaultValue="brand">
        <TabsList className="adm-tabs h-auto justify-start gap-1 rounded-none border-0 bg-transparent p-0">
          {/* TabsList keeps tab-switching behavior; .adm-tabs gives Plume styling */}
          <TabsTrigger value="brand" className={TAB_CLASS}>Brand</TabsTrigger>
          <TabsTrigger value="theme" className={TAB_CLASS}>Theme</TabsTrigger>
          <TabsTrigger value="currency" className={TAB_CLASS}>Currency & Locale</TabsTrigger>
          <TabsTrigger value="features" className={TAB_CLASS}>Features</TabsTrigger>
          <TabsTrigger value="payments" className={TAB_CLASS}>Payments</TabsTrigger>
          <TabsTrigger value="shipping" className={TAB_CLASS}>Shipping</TabsTrigger>
          <TabsTrigger value="tax" className={TAB_CLASS}>Tax</TabsTrigger>
        </TabsList>

        <TabsContent value="brand">
          <BrandTab
            initial={{
              name: str(brandRecord.name, 'Stationery Store'),
              tagline: str(brandRecord.tagline),
              logoAssetId: str(brandRecord.logoAssetId),
              supportEmail: str(brandRecord.supportEmail),
              supportPhone: str(brandRecord.supportPhone),
            }}
          />
        </TabsContent>

        <TabsContent value="theme">
          <ThemeTab
            initial={{
              primary: cfg.theme.color.primary,
              secondary: cfg.theme.color.secondary,
              sans: cfg.theme.type.sans,
              serif: cfg.theme.type.serif,
              spacingScale: scaleToSize(cfg.theme.spacingScale),
              radius: cfg.theme.radius,
            }}
          />
        </TabsContent>

        <TabsContent value="currency">
          <CurrencyLocaleTab
            initial={{
              currencyCode: cfg.currency.code,
              currencySymbol: cfg.currency.symbol,
              defaultLocale: cfg.locale.default,
              supportedLocales: [...cfg.locale.supported],
            }}
          />
        </TabsContent>

        <TabsContent value="features">
          <FeaturesTab initial={features} />
        </TabsContent>

        <TabsContent value="payments">
          <ManagedElsewhere
            title="Payments"
            description="Payment provider selection and credentials live with the payments module."
            target="Coming in a follow-up admin section. Defaults: Razorpay (primary) + Stripe, configured via environment for now."
          />
        </TabsContent>

        <TabsContent value="shipping">
          <ManagedElsewhere
            title="Shipping"
            description="Zones, rates, and per-method overrides will be managed here once the shipping admin lands."
            target="Configure via site_config / shipping module for now."
          />
        </TabsContent>

        <TabsContent value="tax">
          <ManagedElsewhere
            title="Tax"
            description="Tax rates and HSN/GST mappings will be managed here once the tax admin lands."
            target="Configured via the tax module rules tables for now."
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ManagedElsewhere({
  title,
  description,
  target,
}: {
  title: string;
  description: string;
  target: string;
}) {
  return (
    <div className="panel panel-pad">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>{title}</h3>
        <span className="statpill sp-draft">Coming soon</span>
      </div>
      <p className="t-sub" style={{ marginBottom: 10 }}>{description}</p>
      <p className="t-sub">{target}</p>
    </div>
  );
}

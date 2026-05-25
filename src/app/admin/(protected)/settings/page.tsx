import { getAdminContext } from '../_lib/context';
import { PageHeader } from '../_lib/ui';
import { loadSiteConfig } from '@/modules/config/loader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

import { BrandTab } from './_components/BrandTab';
import { ThemeTab, scaleToSize } from './_components/ThemeTab';
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
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Brand, theme, currency, locales, and feature flags for this store."
      />

      <Tabs defaultValue="brand">
        <TabsList>
          <TabsTrigger value="brand">Brand</TabsTrigger>
          <TabsTrigger value="theme">Theme</TabsTrigger>
          <TabsTrigger value="currency">Currency & Locale</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="shipping">Shipping</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
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
    </div>
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{target}</CardContent>
    </Card>
  );
}

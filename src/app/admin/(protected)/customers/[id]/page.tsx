import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminContext } from '../../_lib/context';
import { PageHeader } from '../../_lib/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCustomer } from '@/modules/customers/customers';
import { listAddresses } from '@/modules/customers/addresses';
import { listOrders } from '@/modules/orders/lifecycle';
import { CustomerNotFoundError } from '@/modules/customers/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ORDER_STATUS_VARIANT } from '../../orders/_status';
import { AddressList } from './_components/AddressList';

export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { storeId } = await getAdminContext();

  let customer;
  try {
    customer = await getCustomer(storeId, id);
  } catch (err) {
    if (err instanceof CustomerNotFoundError) notFound();
    throw err;
  }

  // Orders by this customer (filtered via the denormalized order email; the
  // module's customerEmail filter handles both registered and guest orders for
  // the same email — which is the desired admin view).
  const [addresses, ordersResult] = await Promise.all([
    listAddresses(storeId, customer.id),
    listOrders(storeId, { customerEmail: customer.email, limit: 50 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.email}
        description={`Customer · ${customer.locale}`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ProfileField label="Email" value={customer.email} />
            <ProfileField label="Phone" value={customer.phone ?? '—'} />
            <ProfileField label="Locale" value={customer.locale} />
            <ProfileField label="Segment" value={customer.segment ?? '—'} />
            <ProfileField
              label="Marketing opt-in"
              value={customer.acceptsMarketing ? 'Yes' : 'No'}
            />
            <Separator />
            <ProfileField
              label="Lifetime value"
              value={formatMoney(customer.lifetimeValueCents)}
            />
            <ProfileField
              label="Orders on file"
              value={String(ordersResult.items.length)}
            />
            <ProfileField
              label="Customer since"
              value={formatDateTime(customer.createdAt)}
            />
            <ProfileField
              label="Account"
              value={customer.userId ? 'Registered' : 'Guest'}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Order history</CardTitle>
          </CardHeader>
          <CardContent>
            {ordersResult.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No orders for this customer yet.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Placed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersResult.items.map(o => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <Link
                            href={
                              `/admin/orders/${o.id}` as Parameters<typeof Link>[0]['href']
                            }
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {o.number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={ORDER_STATUS_VARIANT[o.status] ?? 'secondary'}
                          >
                            {o.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{o.paymentStatus}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(o.totalCents, o.currency)}
                        </TableCell>
                        <TableCell>{formatDateTime(o.placedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Address book</CardTitle>
        </CardHeader>
        <CardContent>
          <AddressList
            customerId={customer.id}
            addresses={addresses.map(a => ({
              id: a.id,
              type: a.type,
              name: a.name,
              line1: a.line1,
              line2: a.line2,
              city: a.city,
              region: a.region,
              postal: a.postal,
              country: a.country,
              phone: a.phone,
              isDefault: a.isDefault,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

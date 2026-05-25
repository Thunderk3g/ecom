import { PageHeader } from '../../_lib/ui';
import { PromotionForm } from '../_components/PromotionForm';
import type { PromotionFormInput } from '../actions';

export const dynamic = 'force-dynamic';

const EMPTY_INITIAL: PromotionFormInput = {
  code: '',
  name: '',
  type: 'percent',
  status: 'draft',
  percent: 10,
  valueCents: null,
  minSubtotalCents: null,
  bxgyBuy: null,
  bxgyGet: null,
  startsAt: '',
  endsAt: '',
  usageLimit: null,
  perCustomerLimit: null,
  stackable: false,
};

export default function NewPromotionPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="New promotion"
        description="Create a coupon code or automatic discount."
      />
      <PromotionForm mode="create" initial={EMPTY_INITIAL} />
    </div>
  );
}

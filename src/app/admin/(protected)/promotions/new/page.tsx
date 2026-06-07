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
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            New promotion
          </h2>
          <span className="t-sub">Create a coupon code or automatic discount.</span>
        </div>
      </div>
      <PromotionForm mode="create" initial={EMPTY_INITIAL} />
    </>
  );
}

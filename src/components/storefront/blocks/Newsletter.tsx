import { Reveal } from '@/components/storefront/motion';
import { NewsletterForm } from '@/components/storefront/overlays';

export type NewsletterProps = {
  heading?: string;
  placeholder?: string;
  buttonLabel?: string;
};

/**
 * Newsletter block — closing ink band with a giant serif watermark, gold
 * eyebrow and the shared `NewsletterForm` island (pending → success states,
 * styled by the chrome `.news` / `.news-status` classes, which are designed
 * for dark surfaces). `placeholder`/`buttonLabel` remain in the CMS schema
 * but the shared form owns its field copy, so they are not threaded through.
 */
export function Newsletter({ heading }: NewsletterProps) {
  return (
    <section className="hm-news">
      <span className="hm-news-wm" aria-hidden>&amp;</span>
      <div className="wrap">
        <Reveal className="hm-news-inner" y={26}>
          <span className="eyebrow">Newsletter</span>
          <h2 className="hm-news-title">{heading ?? 'Stay in the loop'}</h2>
          <div className="hm-news-form">
            <NewsletterForm />
          </div>
          <p className="hm-news-fine">One list per season. No noise, unsubscribe anytime.</p>
        </Reveal>
      </div>
    </section>
  );
}

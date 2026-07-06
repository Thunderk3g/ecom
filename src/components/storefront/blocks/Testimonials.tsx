import { Reveal, Stagger } from '@/components/storefront/motion';

export type TestimonialsProps = {
  heading?: string;
  items: { quote: string; name: string; role?: string }[];
};

/**
 * Testimonials block. Refined quote cards on the sunken paper band: oversized
 * Playfair quote mark, serif body, initial-avatar attribution. Cards stagger
 * in on scroll; below 900px the grid becomes a scroll-snap rail.
 */
export function Testimonials({ heading, items }: TestimonialsProps) {
  return (
    <section className="section hm-quotes-sec">
      <div className="wrap-wide">
        <Reveal className="hm-head hm-head-center" y={22}>
          <div>
            <span className="eyebrow">Word of mouth</span>
            {heading ? <h2 className="h-lg hm-head-title">{heading}</h2> : null}
          </div>
        </Reveal>
        <Stagger className="hm-quotes" interval={110} y={26}>
          {items.map((item, i) => (
            <figure key={i} className="hm-quote hover-lift">
              <span className="hm-quote-mark" aria-hidden>&ldquo;</span>
              <blockquote>{item.quote}</blockquote>
              <figcaption className="hm-quote-who">
                <span className="hm-quote-avatar" aria-hidden>
                  {item.name.charAt(0).toUpperCase()}
                </span>
                <span className="hm-quote-id">
                  <strong>{item.name}</strong>
                  {item.role ? <span className="meta">{item.role}</span> : null}
                </span>
              </figcaption>
            </figure>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

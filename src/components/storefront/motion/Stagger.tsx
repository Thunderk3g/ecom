'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

/**
 * `Stagger` — reveals its direct children one after another.
 *
 * Renders a container with the `.m-stagger` class; when it enters the viewport
 * it gains `.is-inview` and each *direct* child transitions in with an
 * incremental delay (`interval` ms per child, CSS-driven via nth-child rules —
 * capped at 12 children; children beyond the 12th share the max delay).
 *
 * Children need no wrapper or class of their own — do NOT nest a `<Reveal>`
 * directly as a child (it would double-animate). Container-level props mirror
 * `Reveal` (`as`, `y`, `once`, `className`).
 *
 * @example
 * <Stagger className="pgrid" interval={90}>
 *   {products.map(p => <ProductCard key={p.id} product={p} />)}
 * </Stagger>
 */
export type StaggerProps = {
  /** Element tag to render (default `'div'`). */
  as?: ElementType;
  /** Delay between consecutive children in ms (default 80). */
  interval?: number;
  /** Vertical offset in px each child rises from (default 20). */
  y?: number;
  /** Animate only the first time it enters the viewport (default true). */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Stagger({
  as,
  interval = 80,
  y = 20,
  once = true,
  className,
  style,
  children,
}: StaggerProps) {
  const Tag: ElementType = as ?? 'div';
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const vars = {
    '--stagger-interval': `${interval}ms`,
    '--rv-y': `${y}px`,
    ...style,
  } as CSSProperties;

  const cls = ['m-stagger', inView ? 'is-inview' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <Tag ref={ref} className={cls} style={vars}>
      {children}
    </Tag>
  );
}

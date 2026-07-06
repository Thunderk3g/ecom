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
 * `Reveal` — IntersectionObserver scroll-reveal wrapper.
 *
 * Renders `children` inside an element (default `<div>`) with the `.m-reveal`
 * class. When the element scrolls into view it gains `.is-inview`, which the
 * CSS in `src/styles/motion.css` uses to transition from
 * `opacity: 0; translateY(var(--rv-y))` to its natural position.
 *
 * - Content is only hidden pre-reveal under
 *   `(prefers-reduced-motion: no-preference) and (scripting: enabled)`, so
 *   no-JS visitors and reduced-motion users always see the content.
 * - `once: false` re-hides (and re-reveals) as the element leaves/enters view.
 *
 * @example
 * <Reveal as="section" delay={120} y={32}>
 *   <h2 className="h-lg">Best sellers</h2>
 * </Reveal>
 */
export type RevealProps = {
  /** Element tag to render (default `'div'`). */
  as?: ElementType;
  /** Transition delay in milliseconds (default 0). */
  delay?: number;
  /** Vertical offset in px the element rises from (default 24). */
  y?: number;
  /** Reveal only the first time it enters the viewport (default true). */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Reveal({
  as,
  delay = 0,
  y = 24,
  once = true,
  className,
  style,
  children,
}: RevealProps) {
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
      // Fire once the element's leading edge clears the bottom 8% of the
      // viewport; threshold 0 so arbitrarily tall sections still trigger.
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const vars = {
    '--rv-y': `${y}px`,
    '--rv-delay': `${delay}ms`,
    ...style,
  } as CSSProperties;

  const cls = ['m-reveal', inView ? 'is-inview' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <Tag ref={ref} className={cls} style={vars}>
      {children}
    </Tag>
  );
}

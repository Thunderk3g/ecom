'use client';

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { usePrefersReducedMotion } from './use-reduced-motion';

/**
 * `Parallax` — gentle counter-scroll drift for imagery.
 *
 * Wraps children in an inner element that translates vertically as the outer
 * element moves through the viewport (rAF-throttled, passive scroll listener,
 * only active while intersecting). The offset is proportional to the
 * element's distance from the viewport centre, scaled by `speed` and clamped
 * to ±`maxOffset` px. Fully disabled under `prefers-reduced-motion: reduce`.
 *
 * Give the *outer* element (`className`) any sizing/overflow styles; the
 * transform is applied to the `.m-parallax-inner` wrapper so measurement
 * never feeds back into itself.
 *
 * @example
 * <Parallax speed={0.15} maxOffset={40} className="hero-art">
 *   <img src="/images/hero.png" alt="" />
 * </Parallax>
 */
export type ParallaxProps = {
  /** Element tag for the outer wrapper (default `'div'`). */
  as?: ElementType;
  /** Drift factor relative to scroll distance (default 0.12; keep ≤ 0.3). */
  speed?: number;
  /** Maximum absolute offset in px (default 48). */
  maxOffset?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Parallax({
  as,
  speed = 0.12,
  maxOffset = 48,
  className,
  style,
  children,
}: ParallaxProps) {
  const Tag: ElementType = as ?? 'div';
  const outerRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      inner.style.transform = '';
      return;
    }

    let active = false;
    let raf = 0;

    const update = (): void => {
      raf = 0;
      const rect = outer.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const delta = rect.top + rect.height / 2 - vh / 2;
      const offset = Math.max(-maxOffset, Math.min(maxOffset, -delta * speed));
      inner.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    };

    const schedule = (): void => {
      if (active && raf === 0) raf = requestAnimationFrame(update);
    };

    const io = new IntersectionObserver(
      entries => {
        active = entries[0]?.isIntersecting ?? false;
        if (active) schedule();
      },
      { rootMargin: '25% 0px' },
    );
    io.observe(outer);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      inner.style.transform = '';
    };
  }, [speed, maxOffset, reduced]);

  const cls = ['m-parallax', className ?? ''].filter(Boolean).join(' ');

  return (
    <Tag ref={outerRef} className={cls} style={style}>
      <div ref={innerRef} className="m-parallax-inner">
        {children}
      </div>
    </Tag>
  );
}

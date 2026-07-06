'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './use-reduced-motion';

/**
 * `AnimatedNumber` — counts up to `value` when scrolled into view.
 *
 * Server-renders the *final* formatted value (so no-JS visitors and crawlers
 * see real numbers); once the element enters the viewport it counts up from 0
 * with an ease-out curve. Runs once. Under reduced motion the final value is
 * shown immediately.
 *
 * @example
 * <AnimatedNumber value={12000} suffix="+" />                        // 12,000+
 * <AnimatedNumber value={4.8} formatter={n => n.toFixed(1)} />       // 4.8
 * <AnimatedNumber value={25} prefix="₹" suffix=" lakh" duration={900} />
 */
export type AnimatedNumberProps = {
  /** Target value counted up to. */
  value: number;
  /** Count-up duration in ms (default 1400). */
  duration?: number;
  /** Formats each frame's value (default: round + `toLocaleString('en-IN')`). */
  formatter?: (n: number) => string;
  /** Static string rendered before the number (e.g. `"₹"`). */
  prefix?: string;
  /** Static string rendered after the number (e.g. `"+"`). */
  suffix?: string;
  className?: string;
};

const defaultFormatter = (n: number): string =>
  Math.round(n).toLocaleString('en-IN');

export function AnimatedNumber({
  value,
  duration = 1400,
  formatter,
  prefix,
  suffix,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(value);
  const startedRef = useRef(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    // Keep in sync if `value` changes after (or without) animating.
    if (startedRef.current) setDisplay(value);
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el || startedRef.current) return;
    if (typeof IntersectionObserver === 'undefined') return;

    let raf = 0;
    const io = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry?.isIntersecting || startedRef.current) return;
        startedRef.current = true;
        io.disconnect();
        if (reduced) {
          setDisplay(value);
          return;
        }
        const t0 = performance.now();
        const tick = (now: number): void => {
          const t = Math.min(1, (now - t0) / duration);
          const eased = 1 - Math.pow(2, -10 * t); // easeOutExpo
          setDisplay(t >= 1 ? value : value * eased);
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        setDisplay(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, duration, reduced]);

  const fmt = formatter ?? defaultFormatter;
  const cls = ['m-num', className ?? ''].filter(Boolean).join(' ');

  return (
    <span ref={ref} className={cls}>
      {prefix}
      {fmt(display)}
      {suffix}
    </span>
  );
}

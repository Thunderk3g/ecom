'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * `Marquee` — infinite horizontal loop for announcement strips / logo rails.
 *
 * The children are measured after mount and repeated enough times to always
 * cover the container, then duplicated once more (`aria-hidden` on every copy
 * but the first) so the CSS `translateX(-50%)` keyframe loops seamlessly.
 *
 * - `speed` is the scroll velocity in px/second (default 60); the loop
 *   duration is derived from the measured content width so pace is constant
 *   at any viewport size.
 * - Pauses while hovered (`pauseOnHover`, default true).
 * - Under `prefers-reduced-motion: reduce` the strip is static: no animation,
 *   the first copy simply overflows (hidden) like a normal line of text.
 *
 * @example
 * <Marquee speed={50} aria-label="Store announcements">
 *   <span className="annbar-item">Free shipping over ₹999</span>
 *   <span className="annbar-item">School-season stock is in</span>
 * </Marquee>
 */
export type MarqueeProps = {
  /** Scroll velocity in pixels per second (default 60). */
  speed?: number;
  /** Pause the loop while the pointer is over it (default true). */
  pauseOnHover?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessible label for the strip (it is a `role="marquee"`-free simple region). */
  'aria-label'?: string;
  children?: ReactNode;
};

export function Marquee({
  speed = 60,
  pauseOnHover = true,
  className,
  style,
  children,
  ...rest
}: MarqueeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [copies, setCopies] = useState(1);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    const container = containerRef.current;
    const group = groupRef.current;
    if (!container || !group) return;

    const measure = (): void => {
      const containerWidth = container.offsetWidth;
      const groupWidth = group.offsetWidth;
      if (containerWidth === 0 || groupWidth === 0) return;
      const needed = Math.max(1, Math.ceil(containerWidth / groupWidth));
      setCopies(needed);
      const half = needed * groupWidth;
      setDuration(Math.max(8, half / Math.max(1, speed)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(group);
    return () => ro.disconnect();
  }, [speed, children]);

  const vars = {
    '--marquee-duration': `${duration}s`,
    ...style,
  } as CSSProperties;

  const cls = [
    'm-marquee',
    pauseOnHover ? 'm-marquee-hoverpause' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // Track = two identical halves; each half = `copies` groups of the children.
  const half = (offset: number, refFirst: boolean): ReactNode =>
    Array.from({ length: copies }, (_, i) => (
      <div
        className="m-marquee-group"
        key={`${offset}-${i}`}
        ref={refFirst && i === 0 ? groupRef : undefined}
        aria-hidden={refFirst && i === 0 ? undefined : true}
      >
        {children}
      </div>
    ));

  return (
    <div ref={containerRef} className={cls} style={vars} {...rest}>
      <div className="m-marquee-track">
        {half(0, true)}
        {half(1, false)}
      </div>
    </div>
  );
}

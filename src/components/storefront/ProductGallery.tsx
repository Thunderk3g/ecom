'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { useOverlay } from '@/components/storefront/overlays';

/**
 * PDP gallery: crossfading main frame + thumbnail rail, cursor-tracked hover
 * zoom (fine pointers only), and a focus-trapped click-to-zoom lightbox
 * (Escape closes, arrow keys navigate; z-index 55 per the motion contract).
 * Products without imagery get the MediaPlaceholder duotone as first-class
 * main art — no zoom affordances.
 */
export function ProductGallery({
  productName,
  slug,
  images,
}: {
  productName: string;
  slug: string;
  images: string[];
}) {
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  useOverlay({ open: lightboxOpen, onClose: closeLightbox, panelRef });

  const count = images.length;

  const step = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setActive(i => (i + delta + count) % count);
    },
    [count],
  );

  // Arrow-key navigation while the lightbox is open (Escape lives in useOverlay).
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxOpen, step]);

  // Track the cursor for the hover zoom lens (CSS reads --zx/--zy).
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const el = mainRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--zx', `${Math.min(100, Math.max(0, x))}%`);
    el.style.setProperty('--zy', `${Math.min(100, Math.max(0, y))}%`);
  }

  if (count === 0) {
    return (
      <div className="pdp-gallery">
        <div className="pdp-main pdp-main-art">
          <MediaPlaceholder label={productName} slug={slug} aspect="1/1" showLabel={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="pdp-gallery">
      <div
        ref={mainRef}
        className="pdp-main pdp-zoomable"
        onPointerMove={onPointerMove}
        onClick={() => setLightboxOpen(true)}
      >
        {images.map((src, i) => (
          <img
            key={src}
            src={src}
            alt={i === active ? productName : ''}
            aria-hidden={i !== active}
            draggable={false}
            loading={i === 0 ? 'eager' : 'lazy'}
            className={i === active ? 'pdp-img on' : 'pdp-img'}
          />
        ))}
        <button
          type="button"
          className="zoom pdp-zoom-btn"
          aria-haspopup="dialog"
          onClick={e => {
            e.stopPropagation();
            setLightboxOpen(true);
          }}
        >
          <Maximize2 aria-hidden size={16} strokeWidth={1.75} />
          <span className="sr-only">Open image viewer</span>
        </button>
        {count > 1 ? (
          <span className="pdp-main-count meta" aria-hidden="true">
            {active + 1} / {count}
          </span>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="pdp-thumbs" role="group" aria-label="Product images">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              className={i === active ? 'pdp-thumb pdp-thumb-btn on' : 'pdp-thumb pdp-thumb-btn'}
              aria-label={`Show image ${i + 1} of ${count}`}
              aria-current={i === active}
              onClick={() => setActive(i)}
            >
              <img src={src} alt="" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}

      {/* Lightbox */}
      <div
        className={lightboxOpen ? 'pdp-lb-scrim open' : 'pdp-lb-scrim'}
        onClick={closeLightbox}
        aria-hidden="true"
      />
      <section
        ref={panelRef}
        className={lightboxOpen ? 'pdp-lb open' : 'pdp-lb'}
        role="dialog"
        aria-modal="true"
        aria-label={`${productName} — image viewer`}
        inert={!lightboxOpen}
      >
        <button type="button" className="pdp-lb-close" onClick={closeLightbox} data-autofocus>
          <X aria-hidden size={18} strokeWidth={1.75} />
          <span className="sr-only">Close image viewer</span>
        </button>
        {count > 1 ? (
          <>
            <button
              type="button"
              className="pdp-lb-nav prev"
              onClick={() => step(-1)}
              aria-label="Previous image"
            >
              <ChevronLeft aria-hidden size={20} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="pdp-lb-nav next"
              onClick={() => step(1)}
              aria-label="Next image"
            >
              <ChevronRight aria-hidden size={20} strokeWidth={1.75} />
            </button>
          </>
        ) : null}
        <div className="pdp-lb-stage" onClick={closeLightbox}>
          <img
            key={images[active]}
            src={images[active]}
            alt={`${productName} — image ${active + 1} of ${count}`}
            onClick={e => e.stopPropagation()}
            draggable={false}
          />
        </div>
        {count > 1 ? (
          <div className="pdp-lb-dots" role="group" aria-label="Choose image">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                className={i === active ? 'pdp-lb-dot on' : 'pdp-lb-dot'}
                aria-label={`Image ${i + 1}`}
                aria-current={i === active}
                onClick={() => setActive(i)}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

'use client';

import { useState } from 'react';

export function ProductGallery({
  productName,
  images,
}: {
  productName: string;
  images: string[];
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (images.length === 0) {
    return (
      <div className="pdp-gallery">
        <div className="pdp-main ph" data-label={`product · ${productName}`}>
          <div className="zoom">⊕</div>
        </div>
      </div>
    );
  }

  const activeImage = images[activeIdx] || images[0];

  return (
    <div className="pdp-gallery">
      <div className="pdp-main">
        <img
          src={activeImage}
          alt={productName}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <div className="zoom">⊕</div>
      </div>
      {images.length > 1 ? (
        <div className="pdp-thumbs">
          {images.map((img, i) => (
            <div
              key={img}
              onClick={() => setActiveIdx(i)}
              className={`pdp-thumb ${i === activeIdx ? 'on' : ''}`}
              style={{ cursor: 'pointer' }}
            >
              <img
                src={img}
                alt={`${productName} thumbnail ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

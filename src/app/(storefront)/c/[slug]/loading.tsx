/**
 * Category listing skeleton — shimmer placeholders mirroring the hero,
 * filter rail, toolbar and product grid (styles in src/styles/listing.css).
 */
export default function CategoryLoading() {
  return (
    <div aria-busy="true" aria-label="Loading category">
      <section className="cat-hero">
        <div className="wrap-wide">
          <div className="sk sk-crumb" />
          <div className="cat-hero-inner">
            <div>
              <div className="sk sk-eyebrow" />
              <div className="sk sk-title" />
              <div className="sk sk-lede" />
            </div>
            <div className="sk cat-hero-art" />
          </div>
        </div>
      </section>
      <div className="wrap-wide">
        <div className="lst-toolbar">
          <div className="sk sk-count" />
          <div className="sk sk-sort" />
        </div>
        <div className="shop-layout">
          <div className="lst-skel-rail" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="sk sk-facet" />
            ))}
          </div>
          <div className="pgrid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="sk-card" aria-hidden="true">
                <div className="sk sk-plate" />
                <div className="sk sk-line w-70" />
                <div className="sk sk-line w-40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Search results skeleton — shimmer header + product grid
 * (styles in src/styles/listing.css).
 */
export default function SearchLoading() {
  return (
    <div className="wrap-wide section" aria-busy="true" aria-label="Loading search results">
      <div className="sk sk-eyebrow" />
      <div className="sk sk-title" />
      <div className="lst-toolbar">
        <div className="sk sk-count" />
        <div className="sk sk-sort" />
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
  );
}

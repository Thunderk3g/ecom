/**
 * PDP route-level skeleton: mirrors the gallery/panel grid so the layout
 * doesn't jump when the product streams in. Pure CSS shimmer (`.pdp-skel`).
 */
export default function ProductLoading() {
  return (
    <main className="wrap-wide pdp-page" aria-busy="true" aria-label="Loading product">
      <div className="pdp-skel pdp-skel-crumbs" />
      <div className="pdp-layout">
        <div className="pdp-a-gallery">
          <div className="pdp-skel pdp-skel-main" />
          <div className="pdp-skel-thumbrow">
            <div className="pdp-skel pdp-skel-thumb" />
            <div className="pdp-skel pdp-skel-thumb" />
            <div className="pdp-skel pdp-skel-thumb" />
          </div>
        </div>
        <div className="pdp-a-info">
          <div className="pdp-skel pdp-skel-eyebrow" />
          <div className="pdp-skel pdp-skel-title" />
          <div className="pdp-skel pdp-skel-price" />
          <div className="pdp-skel-pillrow">
            <div className="pdp-skel pdp-skel-pill" />
            <div className="pdp-skel pdp-skel-pill" />
            <div className="pdp-skel pdp-skel-pill" />
          </div>
          <div className="pdp-skel pdp-skel-cta" />
          <div className="pdp-skel pdp-skel-line" />
        </div>
      </div>
    </main>
  );
}

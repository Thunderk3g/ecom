'use client';

import { useId, useState, type ReactNode } from 'react';

export type PdpAccordionItem = {
  id: string;
  title: string;
  body: ReactNode;
};

/**
 * PDP details accordion — animated expand/collapse via the CSS
 * `grid-template-rows: 0fr → 1fr` trick (see `.pdp-acc-*` in
 * src/styles/pdp.css). One panel open at a time; clicking the open header
 * closes it. Bodies arrive as server-rendered ReactNode props, so the markdown
 * description and spec table stay server components.
 */
export function PdpAccordions({
  items,
  defaultOpenId,
}: {
  items: PdpAccordionItem[];
  defaultOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);
  const base = useId();

  if (items.length === 0) return null;

  return (
    <div className="pdp-acc">
      {items.map(item => {
        const open = openId === item.id;
        const panelId = `${base}-${item.id}-panel`;
        const buttonId = `${base}-${item.id}-button`;
        return (
          <section key={item.id} className={open ? 'pdp-acc-item open' : 'pdp-acc-item'}>
            <h3 className="pdp-acc-head">
              <button
                type="button"
                id={buttonId}
                className="pdp-acc-trigger"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span>{item.title}</span>
                <span className="pdp-acc-pm" aria-hidden="true">
                  +
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="pdp-acc-panel"
              inert={!open}
            >
              <div className="pdp-acc-clip">
                <div className="pdp-acc-body">{item.body}</div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

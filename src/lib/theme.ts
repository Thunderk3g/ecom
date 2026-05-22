import type { SiteConfig } from '@/platform.defaults';

export function themeVars(cfg: SiteConfig): string {
  const c = cfg.theme.color;
  const t = cfg.theme.type;
  return [
    `--color-bg:${c.bg}`,
    `--color-fg:${c.fg}`,
    `--color-primary:${c.primary}`,
    `--color-secondary:${c.secondary}`,
    `--font-sans:${t.sans}`,
    `--font-serif:${t.serif}`,
    `--radius:${cfg.theme.radius}`,
  ].join(';');
}

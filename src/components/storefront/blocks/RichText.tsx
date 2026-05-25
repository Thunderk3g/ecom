import Link from 'next/link';
import type { ReactNode } from 'react';

export type RichTextProps = {
  markdown: string;
};

/**
 * Minimal, dependency-free markdown renderer for CMS rich-text blocks.
 *
 * Supports a deliberately small, safe subset (headings, paragraphs, unordered
 * lists, bold, italics, inline links). Everything is rendered as real React
 * elements — never `dangerouslySetInnerHTML` — so there is no HTML-injection
 * surface. A future pass can swap this for a full CommonMark + sanitizer
 * pipeline (the block schema already stores raw markdown).
 */
export function RichText({ markdown }: RichTextProps) {
  const blocks = parseBlocks(markdown);
  return (
    <section className="container py-10">
      <div className="prose prose-sm max-w-prose text-foreground">
        {blocks.map((block, i) => renderBlock(block, i))}
      </div>
    </section>
  );
}

type Block =
  | { type: 'h'; level: 2 | 3; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join(' ') });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list.length) {
      blocks.push({ type: 'ul', items: list });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith('### ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', level: 3, text: line.slice(4) });
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', level: 2, text: line.slice(3) });
    } else if (line.startsWith('# ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', level: 2, text: line.slice(2) });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      flushPara();
      list.push(line.slice(2));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'h':
      return block.level === 2 ? (
        <h2 key={key} className="mt-6 font-serif text-2xl font-semibold tracking-tight">
          {renderInline(block.text)}
        </h2>
      ) : (
        <h3 key={key} className="mt-4 font-serif text-xl font-semibold">
          {renderInline(block.text)}
        </h3>
      );
    case 'ul':
      return (
        <ul key={key} className="my-3 list-disc space-y-1 pl-6">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'p':
    default:
      return (
        <p key={key} className="my-3 leading-relaxed">
          {renderInline(block.text)}
        </p>
      );
  }
}

/** Inline parser: **bold**, *italic*, [text](href). Tokenized, not regex-replaced into HTML. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        const safe = href && /^(https?:\/\/|\/)/.test(href) ? href : '#';
        nodes.push(
          <Link
            key={key++}
            href={safe as Parameters<typeof Link>[0]['href']}
            className="text-brand underline underline-offset-2"
          >
            {label}
          </Link>,
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

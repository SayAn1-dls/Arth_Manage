import { parseMarkdown, type Block, type Inline } from '@arthakram/shared';
import { cn } from './cn.js';

function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((n, i) => {
    if (n.type === 'text') return n.text;
    if (n.type === 'bold') return <strong key={i}>{renderInline(n.children)}</strong>;
    if (n.type === 'italic')
      return (
        <span key={i} className="font-semibold">
          {renderInline(n.children)}
        </span>
      );
    return (
      <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
        {renderInline(n.children)}
      </a>
    );
  });
}

function renderBlock(b: Block, i: number) {
  switch (b.type) {
    case 'heading':
      return b.level === 1 ? (
        <h2 key={i} className="mt-6">
          {renderInline(b.children)}
        </h2>
      ) : (
        <h3 key={i} className="mt-5">
          {renderInline(b.children)}
        </h3>
      );
    case 'paragraph':
      return (
        <p key={i} className="mt-3">
          {renderInline(b.children)}
        </p>
      );
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={i}
          className={cn('mt-3 max-w-measure pl-6', b.ordered ? 'list-decimal' : 'list-disc')}
        >
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <div key={i} className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-blush">
              <tr>
                {b.header.map((c, j) => (
                  <th key={j} scope="col" className="px-3 py-2 font-bold text-ink">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j} className="border-b border-line">
                  {r.map((c, k) => (
                    <td key={k} className="px-3 py-2">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Renders the safe Markdown subset as React elements. User text is never injected as HTML. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return <div className={className}>{blocks.map(renderBlock)}</div>;
}

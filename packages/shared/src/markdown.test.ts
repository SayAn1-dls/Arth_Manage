import { describe, expect, it } from 'vitest';
import { inlineToText, parseInline, parseMarkdown } from './markdown.js';

describe('markdown subset', () => {
  it('parses headings, paragraphs, lists and tables', () => {
    const blocks = parseMarkdown(
      '## Rules\n\nBe **kind** and *curious*.\n\n- one\n- two\n\n1. a\n2. b\n\n| A | B |\n|---|---|\n| 1 | 2 |',
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'table']);
    const table = blocks[4];
    expect(table?.type === 'table' && table.rows.length).toBe(1);
  });
  it('only allows http, https and mailto links; other schemes stay as plain text', () => {
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({
      type: 'text',
      text: '[x](javascript:alert(1))',
    });
    expect(parseInline('[ok](https://example.com)')[0]?.type).toBe('link');
  });
  it('never produces HTML nodes: markup stays as text', () => {
    expect(inlineToText(parseInline('<script>alert(1)</script>'))).toBe(
      '<script>alert(1)</script>',
    );
  });
});

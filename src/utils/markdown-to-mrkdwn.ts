/**
 * Convert standard markdown to Slack mrkdwn format.
 *
 * Key transformations:
 *   **bold** / __bold__   →  *bold*
 *   *italic* / _italic_   →  _italic_
 *   ~~strike~~             →  ~strike~
 *   # Heading              →  *Heading*
 *   [text](url)            →  <url|text>
 *   ![alt](url)            →  <url|alt>  (or just url if no alt)
 *   - item / * item        →  • item
 *   ```lang\ncode```       →  ```\ncode```  (language stripped)
 *   &, < (non-mention), >  →  &amp;, &lt;, &gt;
 *
 * Zero-width spaces (U+200B) are inserted around inline markers to prevent
 * Slack treating mid-word asterisks/underscores as formatting (e.g. hel*l*o).
 */

const ZWS = '\u200B';

// Sentinel placeholders — use null bytes that will never appear in real text
const PLACEHOLDER_PREFIX = '\x00';
const BOLD_OPEN = '\x00B\x00';
const BOLD_CLOSE = '\x00/B\x00';
const ITALIC_OPEN = '\x00I\x00';
const ITALIC_CLOSE = '\x00/I\x00';
const STRIKE_OPEN = '\x00S\x00';
const STRIKE_CLOSE = '\x00/S\x00';
const HEADING_OPEN = '\x00H\x00';
const HEADING_CLOSE = '\x00/H\x00';
const CODE_BLOCK = '\x00CB';
const CODE_INLINE = '\x00CI';
const PLACEHOLDER_END = '\x00';

function isURL(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function escapeSlack(text: string): string {
  // Escape Slack's special characters in plain text segments.
  // We only escape & and < (non-mention) to avoid breaking angle-bracket links
  // we've already emitted as <url|text>.
  return text
    .replace(/&/g, '&amp;')
    .replace(/<(?![@#!])/g, '&lt;');
}

export function markdownToMrkdwn(markdown: string): string {
  const codeBlocks: string[] = [];
  let text = markdown;

  // ── Step 1: extract fenced code blocks ─────────────────────────────────────
  // Must run before any other transformation to protect content.
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.push('```\n' + code + '```') - 1;
    return `${CODE_BLOCK}${idx}${PLACEHOLDER_END}`;
  });

  // ── Step 2: extract inline code ─────────────────────────────────────────────
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = codeBlocks.push('`' + code + '`') - 1;
    return `${CODE_INLINE}${idx}${PLACEHOLDER_END}`;
  });

  // ── Step 3: headings ────────────────────────────────────────────────────────
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, content) => `${HEADING_OPEN}${content.trim()}${HEADING_CLOSE}`);

  // ── Step 4: bold (process before italic to consume ** before *) ─────────────
  text = text.replace(/\*\*([^*\n]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  text = text.replace(/__([^_\n]+)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // ── Step 5: italic ──────────────────────────────────────────────────────────
  // After bold is consumed, remaining single * or _ are italic.
  // Avoid matching inside words for _ (require word boundary or space).
  text = text.replace(/\*([^*\n]+)\*/g, `${ITALIC_OPEN}$1${ITALIC_CLOSE}`);
  text = text.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, `${ITALIC_OPEN}$1${ITALIC_CLOSE}`);

  // ── Step 6: strikethrough ───────────────────────────────────────────────────
  text = text.replace(/~~([^~\n]+)~~/g, `${STRIKE_OPEN}$1${STRIKE_CLOSE}`);

  // ── Step 7: images (before links — `![` contains `[`) ──────────────────────
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    if (!isURL(url)) return alt || url;
    return alt ? `<${url}|${alt}>` : `<${url}>`;
  });

  // ── Step 8: links ───────────────────────────────────────────────────────────
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    if (!isURL(url)) return label;
    return `<${url}|${label}>`;
  });

  // ── Step 9: reference-style link definitions (strip them) ───────────────────
  text = text.replace(/^\[[^\]]+\]:\s+\S+[^\n]*$/gm, '');

  // ── Step 10: unordered lists ────────────────────────────────────────────────
  text = text.replace(/^[ \t]*[-*+]\s+/gm, '• ');

  // ── Step 11: horizontal rules ───────────────────────────────────────────────
  text = text.replace(/^[-*_]{3,}[ \t]*$/gm, '');

  // ── Step 12: escape Slack specials in plain text ────────────────────────────
  // Only escape text outside of our placeholders and already-emitted <url|...>.
  text = text.replace(/[^<>\x00]+/g, (segment) => {
    if (segment.startsWith(PLACEHOLDER_PREFIX)) return segment;
    return escapeSlack(segment);
  });

  // ── Step 13: restore inline formatting with ZWS guards ─────────────────────
  text = text.replace(new RegExp(`${HEADING_OPEN}(.*?)${HEADING_CLOSE}`, 'gs'),
    (_m, inner) => `*${inner}*`);
  text = text.replace(new RegExp(`${BOLD_OPEN}(.*?)${BOLD_CLOSE}`, 'gs'),
    (_m, inner) => `${ZWS}*${inner}*${ZWS}`);
  text = text.replace(new RegExp(`${ITALIC_OPEN}(.*?)${ITALIC_CLOSE}`, 'gs'),
    (_m, inner) => `${ZWS}_${inner}_${ZWS}`);
  text = text.replace(new RegExp(`${STRIKE_OPEN}(.*?)${STRIKE_CLOSE}`, 'gs'),
    (_m, inner) => `${ZWS}~${inner}~${ZWS}`);

  // ── Step 14: restore code blocks ────────────────────────────────────────────
  text = text.replace(
    new RegExp(`(?:${CODE_BLOCK}|${CODE_INLINE})(\\d+)${PLACEHOLDER_END}`, 'g'),
    (_m, idx) => codeBlocks[parseInt(idx, 10)],
  );

  // ── Step 15: tidy up ────────────────────────────────────────────────────────
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

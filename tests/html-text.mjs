// Mimics the text a browser tool returns for a simple static page: head, scripts and styles dropped,
// block elements on their own lines, list items on their own lines, entities decoded, spaces collapsed.
// It is a test helper for the example pages, not a general HTML parser.
const BLOCK = 'address|article|aside|blockquote|body|div|dl|dt|dd|footer|h[1-6]|header|html|li|main|nav|ol|p|section|table|tr|ul';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function htmlToPageText(html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return `${body
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')}\n`;
}

// Page fingerprint for the extract-my-profile skill.
//
// Two modes, both normalized exactly like normalizeBody() in lib.mjs:
//
// - 'innertext' (default): the source element's innerText. Use it with get_page_text, which returns
//   the full text of one source element (it names it, for example "<main>" or "<body>"). Fingerprint
//   the same element, save the get_page_text text, and pass the fingerprint to snapshot.mjs.
// - 'composed': text built by walking into shadow roots and slots. Use it on sites built from web
//   components (for example Salesforce pages), where innerText misses most of the page, on sites
//   where the page-text tool returns nothing, and on edit forms, because it also reads
//   field values, selected options and whether a checkbox or radio button is selected. Passwords and
//   hidden fields are never read. The normalized text is kept in window.__ppCapture; read it in
//   pieces with window.__ppCapture.slice(a, b) (the browser tool cuts output near 1,000 characters) and
//   save the joined pieces.
//
// Before fingerprinting, the capture waits until the page has settled: it reads the text every
// settleMs milliseconds (default 1000) until three reads in a row are identical, for at most 20 reads.
// Some pages load lists after the page shell (for example a list on a Salesforce-based portal), and a capture taken too early
// records them as empty. The result reports settled: false when the page never stopped changing;
// capture again then. settleMs 0 reads once.
//
// The fingerprint is grouped in eight blocks because the browser tool hides a plain 64-character hex
// string. Use with the Claude in Chrome javascript_tool, or any tool that runs JavaScript in the page:
//   await (<this file>)('main')
//   await (<this file>)('body', 'composed')
// Then: node snapshot.mjs save ... --expect-sha256 "<fingerprint>". The snapshot is refused when the
// saved copy differs from what the page fingerprinted.
async (selector = 'body', mode = 'innertext', settleMs = 1000) => {
  const element = document.querySelector(selector);
  if (!element) return { error: `No element matches ${selector}` };

  const composedText = (root) => {
    const block = /^(block|flex|grid|list-item|table|table-row|table-caption|flow-root)$/;
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.data.replace(/\s+/g, ' ');
        return;
      }
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        node.childNodes.forEach(walk);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      // Icons (SVG) and their style blocks are not profile text.
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/.test(node.tagName.toUpperCase())) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      // Text kept only for screen readers sits in a 1-pixel clipped box.
      const box = node.getBoundingClientRect();
      if (style.position === 'absolute' && box.width <= 1 && box.height <= 1) return;
      if (node.tagName === 'BR') {
        out += '\n';
        return;
      }
      // Form fields hold their values outside the text: profile edit pages show everything this way.
      // Passwords and hidden fields are never read.
      if (node.tagName === 'INPUT') {
        const type = (node.type || 'text').toLowerCase();
        if (type === 'password' || type === 'hidden' || type === 'file') return;
        if (type === 'checkbox' || type === 'radio') {
          out += node.checked ? ' [selected] ' : ' [not selected] ';
          return;
        }
        if (['button', 'submit', 'reset', 'image'].includes(type)) return;
        out += `\n${node.value}\n`;
        return;
      }
      if (node.tagName === 'TEXTAREA') {
        out += `\n${node.value}\n`;
        return;
      }
      if (node.tagName === 'SELECT') {
        out += `\n${[...node.selectedOptions].map((option) => option.text).join(', ')}\n`;
        return;
      }
      const isBlock = block.test(style.display);
      if (isBlock) out += '\n';
      if (node.tagName === 'SLOT') {
        const assigned = node.assignedNodes({ flatten: true });
        (assigned.length > 0 ? assigned : [...node.childNodes]).forEach(walk);
      } else {
        (node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes).forEach(walk);
      }
      if (isBlock) out += '\n';
    };
    walk(root);
    return out.replace(/\n[ \t]*(?=\n)/g, '\n').replace(/\n{2,}/g, '\n');
  };

  const read = () => (mode === 'composed' ? composedText(element) : String(element.innerText));
  let raw = read();
  let settled = true;
  if (settleMs > 0) {
    let same = 1;
    let reads = 1;
    while (same < 3 && reads < 20) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      const next = read();
      reads += 1;
      same = next === raw ? same + 1 : 1;
      raw = next;
    }
    settled = same >= 3;
  }
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/^ | $/g, ''));
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const text = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (mode === 'composed') window.__ppCapture = text;
  return { source: selector, mode, settled, fingerprint: hex.match(/.{8}/g).join(' '), chars: text.length, lines: lines.length };
}

/**
 * En liten parser for SVG-markup fra renderToStaticMarkup, så testene kan spørre etter elementer uten
 * jsdom (jsdom 31 krever Node ≥ 22.15). Markupen er velformet, uten kommentarer og CDATA.
 */
export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: El[];
  /** Tekst direkte i elementet. */
  text: string;
  parent?: El;
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function parseMarkup(xml: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [], text: "" };
  let current = root;
  const token = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    if (m[5] !== undefined) {
      current.text += decode(m[5]);
      continue;
    }
    const [, close, tag, attrText = "", selfClose] = m;
    if (close) {
      if (current.tag !== tag) throw new Error(`Uventet </${tag}>, ventet </${current.tag}>`);
      current = current.parent!;
      continue;
    }
    const attrs = Object.fromEntries([...attrText.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, decode(a[2]!)]));
    const el: El = { tag: tag!, attrs, children: [], text: "", parent: current };
    current.children.push(el);
    if (!selfClose) current = el;
  }
  if (current !== root) throw new Error(`<${current.tag}> er ikke lukket`);
  return root;
}

export function findAll(el: El, pred: (e: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (e: El) => {
    if (pred(e)) out.push(e);
    e.children.forEach(walk);
  };
  el.children.forEach(walk);
  return out;
}

export function textContent(el: El): string {
  return el.text + el.children.map(textContent).join("");
}

export const hasClass = (el: El, cls: string) => (el.attrs.class ?? "").split(/\s+/).includes(cls);

export function within(el: El, cls: string): boolean {
  for (let p = el.parent; p; p = p.parent) if (hasClass(p, cls)) return true;
  return false;
}

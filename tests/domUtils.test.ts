/**
 * Tests for domUtils.ts — verdict injection positioning.
 *
 * Regression tests to ensure verdicts are appended to the end
 * of the product card (not prepended before first child) when afterEl
 * is not a direct child of parent.
 */

import { injectVerdict, removeVerdictById, type VerdictContent } from '../src/domUtils';

interface MockElement {
  tagName: string;
  id: string;
  style: Record<string, string>;
  textContent: string;
  childNodes: MockElement[];
  parentElement: MockElement | null;
  readonly firstChild: MockElement | null;
  readonly nextSibling: MockElement | null;
  appendChild(child: MockElement): MockElement;
  insertBefore(newChild: MockElement, refChild: MockElement | null): MockElement;
  querySelectorAll(selector: string): MockElement[];
  remove(): void;
}

// Minimal DOM mocking for Node environment
function createElement(tag: string, id?: string): MockElement {
  const children: MockElement[] = [];

  const el: MockElement = {
    tagName: tag.toUpperCase(),
    id: id ?? '',
    style: {} as Record<string, string>,
    textContent: '',
    childNodes: children,
    get firstChild() {
      return children[0] ?? null;
    },
    parentElement: null,
    get nextSibling(): MockElement | null {
      if (!el.parentElement) return null;
      const siblings = el.parentElement.childNodes;
      const idx = siblings.indexOf(el);
      return siblings[idx + 1] ?? null;
    },
    appendChild(child: MockElement) {
      children.push(child);
      child.parentElement = el;
      return child;
    },
    insertBefore(newChild: MockElement, refChild: MockElement | null) {
      if (refChild === null) {
        return el.appendChild(newChild);
      }
      const idx = children.indexOf(refChild);
      if (idx >= 0) {
        children.splice(idx, 0, newChild);
        newChild.parentElement = el;
      } else {
        return el.appendChild(newChild);
      }
      return newChild;
    },
    querySelectorAll(selector: string) {
      return children.filter((c: MockElement) => c.id && selector.includes(c.id));
    },
    remove() {
      if (el.parentElement) {
        const pChildren = el.parentElement.childNodes;
        const idx = pChildren.indexOf(el);
        if (idx >= 0) pChildren.splice(idx, 1);
      }
    },
  };
  return el;
}

// Track all elements created so document.getElementById can find them
const allElements: MockElement[] = [];

// Stub document.createElement, document.getElementById, and CSS.escape for domUtils
const origCreateElement = globalThis.document?.createElement;
const origGetElementById = globalThis.document?.getElementById;
beforeAll(() => {
  if (!globalThis.document) {
    (globalThis as unknown as Record<string, unknown>).document = {} as Document;
  }
  (globalThis.document as unknown as Record<string, unknown>).createElement = (tag: string) => {
    const el = createElement(tag);
    allElements.push(el);
    return el;
  };
  (globalThis.document as unknown as Record<string, unknown>).getElementById = (id: string) => {
    return allElements.find((el) => el.id === id) ?? null;
  };
  if (!globalThis.CSS) {
    (globalThis as unknown as Record<string, unknown>).CSS = { escape: (s: string) => s };
  }
});

afterEach(() => {
  allElements.length = 0;
});

afterAll(() => {
  if (origCreateElement) {
    globalThis.document.createElement = origCreateElement;
  }
  if (origGetElementById) {
    globalThis.document.getElementById = origGetElementById;
  }
});

describe('injectVerdict', () => {
  const content: VerdictContent = {
    lines: [{ type: 'text', text: 'Test verdict', style: 'color: red;' }],
  };

  it('appends verdict to end of parent when afterEl is null', () => {
    const parent = createElement('div');
    const existing = createElement('span', 'existing');
    parent.appendChild(existing);

    injectVerdict(parent as unknown as HTMLElement, 'verdict-1', content, null);

    expect(parent.childNodes.length).toBe(2);
    expect(parent.childNodes[0].id).toBe('existing');
    expect(parent.childNodes[1].id).toBe('verdict-1');
  });

  it('appends verdict to end when afterEl is not a direct child of parent (regression)', () => {
    // This is the regression case: priceEl is nested inside a sub-container,
    // but parent is the top-level product card div. Before the fix, the verdict
    // was prepended (before first child), causing it to appear above the image.
    const parent = createElement('div');
    const image = createElement('img', 'product-image');
    const priceWrapper = createElement('div', 'price-wrapper');
    const priceEl = createElement('span', 'price');
    priceWrapper.appendChild(priceEl);
    parent.appendChild(image);
    parent.appendChild(priceWrapper);

    // priceEl's parentElement is priceWrapper, not parent
    injectVerdict(
      parent as unknown as HTMLElement,
      'verdict-2',
      content,
      priceEl as unknown as Element
    );

    expect(parent.childNodes.length).toBe(3);
    // Verdict should be AFTER the existing children (appended to end),
    // not inserted before the first child
    expect(parent.childNodes[0].id).toBe('product-image');
    expect(parent.childNodes[1].id).toBe('price-wrapper');
    expect(parent.childNodes[2].id).toBe('verdict-2');
  });

  it('sets font-size to 0.85em so verdict text is smaller than the price (regression)', () => {
    const parent = createElement('div');
    injectVerdict(parent as unknown as HTMLElement, 'verdict-font', content, null);
    const verdict = parent.childNodes[0];
    expect(verdict.style.fontSize).toBe('0.85em');
  });

  it('inserts after afterEl when it is a direct child of parent', () => {
    const parent = createElement('div');
    const first = createElement('div', 'first');
    const second = createElement('div', 'second');
    parent.appendChild(first);
    parent.appendChild(second);

    injectVerdict(
      parent as unknown as HTMLElement,
      'verdict-3',
      content,
      first as unknown as Element
    );

    expect(parent.childNodes.length).toBe(3);
    expect(parent.childNodes[0].id).toBe('first');
    expect(parent.childNodes[1].id).toBe('verdict-3');
    expect(parent.childNodes[2].id).toBe('second');
  });
});

describe('removeVerdictById', () => {
  it('removes element with matching id', () => {
    const parent = createElement('div');
    const verdict = createElement('div', 'my-verdict');
    allElements.push(verdict); // register for getElementById
    parent.appendChild(verdict);

    removeVerdictById(parent as unknown as HTMLElement, 'my-verdict');
    expect(parent.childNodes.length).toBe(0);
  });

  it('removes verdict even when parent differs from original injection (regression)', () => {
    // When loading indicator is injected into priceWrapper but final verdict
    // replaces it, removeVerdictById must find the old one via document.getElementById
    const productDiv = createElement('div', 'product');
    const priceWrapper = createElement('div', 'price-wrapper');
    const oldVerdict = createElement('div', 'verdict-x');
    allElements.push(oldVerdict);
    priceWrapper.appendChild(oldVerdict);
    productDiv.appendChild(priceWrapper);

    // Call with productDiv as parent, but verdict lives in priceWrapper
    removeVerdictById(productDiv as unknown as HTMLElement, 'verdict-x');
    expect(priceWrapper.childNodes.length).toBe(0);
  });
});

describe('verdict positioning near price element (regression)', () => {
  const content: VerdictContent = {
    lines: [{ type: 'text', text: 'Verdict', style: 'color: red;' }],
  };

  it('verdict appears inside priceWrapper after priceEl when parent=priceWrapper', () => {
    // Simulates the pre-refactoring pattern:
    // contentScript finds priceEl, uses priceEl.parentElement as parent, priceEl as afterEl
    const productDiv = createElement('div', 'product');
    const image = createElement('img', 'image');
    const priceWrapper = createElement('div', 'price-wrapper');
    const priceEl = createElement('span', 'price');
    priceWrapper.appendChild(priceEl);
    productDiv.appendChild(image);
    productDiv.appendChild(priceWrapper);

    // This is how contentScript now calls injectVerdict:
    // parent = priceEl.parentElement (priceWrapper), afterEl = priceEl
    injectVerdict(
      priceWrapper as unknown as HTMLElement,
      'verdict-pos',
      content,
      priceEl as unknown as Element
    );

    // Verdict should be inside priceWrapper, after priceEl
    expect(priceWrapper.childNodes.length).toBe(2);
    expect(priceWrapper.childNodes[0].id).toBe('price');
    expect(priceWrapper.childNodes[1].id).toBe('verdict-pos');
    // productDiv children are unchanged (image + priceWrapper)
    expect(productDiv.childNodes.length).toBe(2);
  });

  it('falls back to appending to productDiv when no priceEl found', () => {
    const productDiv = createElement('div', 'product');
    const image = createElement('img', 'image');
    const title = createElement('h2', 'title');
    productDiv.appendChild(image);
    productDiv.appendChild(title);

    // No priceEl → parent = productDiv, afterEl = null
    injectVerdict(
      productDiv as unknown as HTMLElement,
      'verdict-fallback',
      content,
      null
    );

    expect(productDiv.childNodes.length).toBe(3);
    expect(productDiv.childNodes[2].id).toBe('verdict-fallback');
  });
});

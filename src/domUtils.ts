// DOM utilities for verdict injection/removal in Next Price Checker
// -----------------------------------------------------------------

export interface VerdictContent {
  lines: VerdictLine[];
}

export type VerdictLine =
  | { type: 'text'; text: string; style?: string }
  | { type: 'link'; text: string; href: string; style?: string }
  | { type: 'br' };

/**
 * Injects a verdict element into the DOM after the given reference element.
 * Builds DOM nodes safely without innerHTML.
 * @param parent The parent element to inject into
 * @param verdictId The unique id for the verdict element
 * @param content Structured verdict content to render
 * @param afterEl The element to insert after (if present)
 */
export function injectVerdict(
  parent: HTMLElement,
  verdictId: string,
  content: VerdictContent,
  afterEl?: Element | null
) {
  removeVerdictById(parent, verdictId);
  const verdictDiv = document.createElement('div');
  verdictDiv.id = verdictId;
  verdictDiv.style.fontWeight = 'bold';
  verdictDiv.style.marginBottom = '4px';
  verdictDiv.style.fontSize = '1.1em';

  for (const line of content.lines) {
    if (line.type === 'br') {
      verdictDiv.appendChild(document.createElement('br'));
    } else if (line.type === 'text') {
      const span = document.createElement('span');
      if (line.style) span.style.cssText = line.style;
      span.textContent = line.text;
      verdictDiv.appendChild(span);
    } else if (line.type === 'link') {
      const a = document.createElement('a');
      a.href = line.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = line.text;
      if (line.style) a.style.cssText = line.style;
      verdictDiv.appendChild(a);
    }
  }

  if (afterEl && afterEl.parentElement === parent) {
    parent.insertBefore(verdictDiv, afterEl.nextSibling);
  } else {
    parent.insertBefore(verdictDiv, parent.firstChild);
  }
}

/**
 * Removes a verdict element by id from the given parent element.
 * @param parent The parent element
 * @param verdictId The id of the verdict element to remove
 */
export function removeVerdictById(parent: HTMLElement, verdictId: string) {
  const old = parent.querySelectorAll(`#${CSS.escape(verdictId)}`);
  old.forEach((el) => el.remove());
}

// DOM utilities for verdict injection/removal in Next Price Checker
// -----------------------------------------------------------------

/**
 * Injects a verdict element into the DOM after the given reference element.
 * Prevents duplicate injection by id.
 * @param parent The parent element to inject into
 * @param verdictId The unique id for the verdict element
 * @param html The HTML content to inject
 * @param afterEl The element to insert after (if present)
 */
export function injectVerdict(
  parent: HTMLElement,
  verdictId: string,
  html: string,
  afterEl?: Element | null
) {
  // Remove any existing verdict with this id in the parent
  removeVerdictById(parent, verdictId);
  const verdictDiv = document.createElement('div');
  verdictDiv.id = verdictId;
  verdictDiv.innerHTML = html;
  verdictDiv.style.fontWeight = 'bold';
  verdictDiv.style.marginBottom = '4px';
  verdictDiv.style.fontSize = '1.1em';
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
  const old = parent.querySelectorAll(`#${verdictId}`);
  old.forEach((el) => el.remove());
}

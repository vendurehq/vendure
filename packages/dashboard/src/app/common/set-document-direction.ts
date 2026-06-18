/**
 * @description
 * Sets the `dir` attribute on the HTML tag, which sets the global text direction
 */
export function setDocumentDirection(direction: 'rtl' | 'ltr') {
    document.documentElement.setAttribute('dir', direction);
}

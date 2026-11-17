import { type Locator, expect } from '@playwright/test';

/**
 * Helpers for Base UI popups — the listbox a select or combobox opens over the page.
 *
 * A popup mounts a frame or two after its trigger is clicked, and it mounts even when the
 * option list is empty. An Escape that arrives before it mounts is ignored. The popup then
 * opens and stays open, and its inert backdrop swallows every later click. Waiting for the
 * popup to be absent does not rule this out, because a popup that has not mounted yet is
 * absent too.
 *
 * So these helpers key off the trigger's `aria-expanded`, which is scoped to the one popup. A
 * document-wide check does not work: an open modal dialog marks everything outside itself with
 * the same `data-base-ui-inert` attribute a popup backdrop uses, so dismissing until those
 * marks clear closes the dialog instead.
 *
 * Select and combobox triggers both carry `aria-expanded` whether open or closed. A combobox
 * rendered with a custom trigger element is the exception — it only gets the attribute while
 * open — so locate such a trigger while its popup is open, or these helpers will wait out
 * their timeout against a missing attribute.
 */

/** Assert that `trigger` has its popup open. */
export async function expectPopupOpen(trigger: Locator) {
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Wait until `trigger` reports its popup closed, however it got there — typing a value that
 * matches no option closes the popup without an Escape, for instance.
 *
 * By this point the fields underneath are usable again. Base UI ties the backdrop's inertness
 * to the popup being closed, but its lifetime to a separate `mounted` flag that outlives the
 * close transition, so the backdrop may still be in the DOM — inert, and no longer
 * hit-testable. Do not wait for it to disappear. The list may also still be fading out, which
 * is the other reason to assert on the trigger rather than on the popup being gone.
 */
export async function expectPopupClosed(trigger: Locator) {
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

/**
 * Dismiss the popup belonging to `trigger`, and wait until it can no longer swallow clicks.
 * Requires the popup to be open, which is what rules out dismissing it too early.
 */
export async function closePopup(trigger: Locator) {
    await expectPopupOpen(trigger);
    await trigger.press('Escape');
    await expectPopupClosed(trigger);
}

import { expect, test } from '@playwright/test';

// #4424 — Built-in form controls do not correctly handle disabled state.
// Base UI components (Switch, Select, Popover) use portals and custom event
// handlers that bypass HTML's native <fieldset disabled> mechanism.
//
// This test page renders every built-in input type with a toggle that sets
// `disabled` via react-hook-form's Controller prop. When disabled:
// - native inputs (<input>, <textarea>) should be non-interactable
// - Base UI Switch should not toggle
// - Base UI Select should not open
// - Base UI Popover (DateTimeInput) should not open

const TEST_PAGE = '/form-inputs-test';

test.describe('Form inputs — disabled state (#4424)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(TEST_PAGE);
        await expect(page.getByText('Form Inputs Test')).toBeVisible();
    });

    test('should render all input types in enabled state', async ({ page }) => {
        // Verify all form inputs render correctly when enabled
        await expect(page.getByText('Inputs are enabled')).toBeVisible();

        // Text field → textbox
        await expect(
            page
                .locator('[data-slot="field"]')
                .filter({
                    has: page.locator('[data-slot="field-label"]').getByText('Text Field', { exact: true }),
                })
                .getByRole('textbox'),
        ).toBeVisible();

        // Number field → spinbutton
        await expect(
            page
                .locator('[data-slot="field"]')
                .filter({
                    has: page.locator('[data-slot="field-label"]').getByText('Number Field', { exact: true }),
                })
                .getByRole('spinbutton'),
        ).toBeVisible();

        // Boolean field → switch
        await expect(
            page
                .locator('[data-slot="field"]')
                .filter({
                    has: page
                        .locator('[data-slot="field-label"]')
                        .getByText('Boolean Field', { exact: true }),
                })
                .getByRole('switch'),
        ).toBeVisible();

        // DateTime field → button (calendar trigger)
        await expect(
            page
                .locator('[data-slot="field"]')
                .filter({
                    has: page
                        .locator('[data-slot="field-label"]')
                        .getByText('DateTime Field', { exact: true }),
                })
                .getByRole('button')
                .first(),
        ).toBeVisible();

        // Select field → combobox
        await expect(
            page
                .locator('[data-slot="field"]')
                .filter({
                    has: page.locator('[data-slot="field-label"]').getByText('Select Field', { exact: true }),
                })
                .getByRole('combobox'),
        ).toBeVisible();
    });

    test('text input should be disabled when toggle is on', async ({ page }) => {
        const field = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Text Field', { exact: true }),
        });
        const input = field.getByRole('textbox');

        // Verify initial value
        await expect(input).toHaveValue('hello world');
        await expect(input).toBeEnabled();

        // Toggle disabled
        await page.getByTestId('toggle-disabled').click();
        await expect(page.getByText('Inputs are disabled')).toBeVisible();

        // Input should be disabled
        await expect(input).toBeDisabled();
    });

    test('number input should be disabled when toggle is on', async ({ page }) => {
        const field = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Number Field', { exact: true }),
        });
        const input = field.getByRole('spinbutton');

        await expect(input).toHaveValue('42');
        await expect(input).toBeEnabled();

        await page.getByTestId('toggle-disabled').click();

        await expect(input).toBeDisabled();
    });

    test('boolean switch should be disabled when toggle is on', async ({ page }) => {
        const field = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Boolean Field', { exact: true }),
        });
        const switchEl = field.getByRole('switch');

        // Should be checked initially
        await expect(switchEl).toBeChecked();

        // Toggle disabled
        await page.getByTestId('toggle-disabled').click();

        // Switch should be disabled
        await expect(switchEl).toBeDisabled();

        // Attempting to click should not change the checked state
        await switchEl.click({ force: true });
        await expect(switchEl).toBeChecked();
    });

    test('datetime input should be disabled when toggle is on', async ({ page }) => {
        const field = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('DateTime Field', { exact: true }),
        });
        const triggerButton = field.locator('button[data-slot="button"]').first();

        // Toggle disabled
        await page.getByTestId('toggle-disabled').click();

        // Trigger button should be disabled
        await expect(triggerButton).toBeDisabled();

        // Clicking should not open the popover
        await triggerButton.click({ force: true });
        const popover = page.locator('[data-slot="popover-content"]');
        await expect(popover).not.toBeVisible();

        // The "X" clear button (if present) should also be disabled
        const clearButton = field.locator('button').last();
        if (await clearButton.isVisible()) {
            await expect(clearButton).toBeDisabled();
        }
    });

    test('select input should be disabled when toggle is on', async ({ page }) => {
        const field = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Select Field', { exact: true }),
        });
        const combobox = field.getByRole('combobox');

        // Should show initial value
        await expect(combobox).toContainText('medium');

        // Toggle disabled
        await page.getByTestId('toggle-disabled').click();

        // Combobox should be disabled
        await expect(combobox).toBeDisabled();

        // Clicking should not open the dropdown
        await combobox.click({ force: true });
        const listbox = page.getByRole('listbox');
        await expect(listbox).not.toBeVisible();
    });

    test('all inputs should be re-enabled when toggle is off', async ({ page }) => {
        // Toggle disabled on
        await page.getByTestId('toggle-disabled').click();
        await expect(page.getByText('Inputs are disabled')).toBeVisible();

        // Toggle disabled off
        await page.getByTestId('toggle-disabled').click();
        await expect(page.getByText('Inputs are enabled')).toBeVisible();

        // All inputs should be enabled again
        const textField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Text Field', { exact: true }),
        });
        await expect(textField.getByRole('textbox')).toBeEnabled();

        const booleanField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Boolean Field', { exact: true }),
        });
        await expect(booleanField.getByRole('switch')).toBeEnabled();

        const selectField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Select Field', { exact: true }),
        });
        await expect(selectField.getByRole('combobox')).toBeEnabled();
    });
});

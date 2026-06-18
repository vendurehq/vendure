import { expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

test.describe('Breadcrumb should update after entity mutation', () => {
    test.describe.configure({ mode: 'serial' });

    const productName = 'Breadcrumb Original Name';
    const updatedName = 'Breadcrumb Updated Name';

    const listConfig = {
        path: '/products',
        title: 'Products',
        newButtonLabel: 'New Product',
    };

    const detailConfig = {
        newPath: '/products/new',
        pathPrefix: '/products/',
        newTitle: 'New product',
    };

    test('should update breadcrumb after renaming a product', async ({ page }) => {
        test.setTimeout(30_000);

        const listPage = new BaseListPage(page, listConfig);
        const detail = new BaseDetailPage(page, detailConfig);

        // Create a product to test with
        await detail.gotoNew();
        await detail.expectNewPageLoaded();
        await detail.fillFields([{ label: 'Product name', value: productName }]);
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await detail.clickCreate();
        await detail.expectSuccessToast(/created/i);
        await detail.expectNavigatedToExisting();

        // Verify the breadcrumb shows the original name
        const breadcrumbNav = page.locator('nav[aria-label="breadcrumb"]');
        await expect(breadcrumbNav).toContainText(productName);

        // Rename the product
        await detail.fillInput('Product name', updatedName);
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await detail.clickUpdate();
        await detail.expectSuccessToast(/updated/i);

        // The breadcrumb should now show the updated name (without navigating away)
        await expect(breadcrumbNav).toContainText(updatedName, { timeout: 5_000 });
        await expect(breadcrumbNav).not.toContainText(productName);

        // Cleanup: delete the product via the list page
        await listPage.goto();
        await listPage.expectLoaded();
        await listPage.search(updatedName);
        await expect(listPage.getRows().first()).toBeVisible();
        await listPage.bulkDelete([0]);
        await listPage.expectSuccessToast();
    });
});

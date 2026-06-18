import { expect, test as setup } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '../../.auth/admin.json');

setup('authenticate as admin', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill('superadmin');
    await page.getByPlaceholder('Password').fill('superadmin');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait until redirected away from login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.context().storageState({ path: authFile });
});

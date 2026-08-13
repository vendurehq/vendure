import { expect, test } from '@playwright/test';

import { LoginPage } from '../../page-objects/login-page.js';

// These tests need a clean browser with no saved auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login', () => {
    test('should display the login form', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.expectVisible();
    });

    test('should login with valid credentials and redirect to home', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.login('superadmin', 'superadmin');
        await expect(page).not.toHaveURL(/\/login/);
    });

    test('should show error with invalid credentials', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.login('bad@email.com', 'wrongpassword');
        await loginPage.expectError();
    });

    test('should redirect to login when accessing protected route unauthenticated', async ({ page }) => {
        await page.goto('/products');
        await expect(page).toHaveURL(/\/login/);
    });
});

// #1116 — administrators should be able to reset a forgotten password
test.describe('Password reset', () => {
    test('login page links to the forgot password page', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await page.getByRole('link', { name: 'Forgot password?' }).click();
        await expect(page).toHaveURL(/\/forgot-password/);
    });

    test('forgot password form shows confirmation after submitting', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.getByPlaceholder('Email').fill('unknown-admin@test.com');
        await page.getByRole('button', { name: 'Send reset link' }).click();
        // A confirmation is shown regardless of whether the email address exists,
        // to avoid leaking which accounts exist
        await expect(page.getByText('Check your email')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();
    });

    test('reset password page without a token shows invalid link message', async ({ page }) => {
        await page.goto('/reset-password');
        await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible();
    });

    test('reset password shows error when passwords do not match', async ({ page }) => {
        await page.goto('/reset-password?token=some-token');
        await page.getByPlaceholder('New password', { exact: true }).fill('new-password-123');
        await page.getByPlaceholder('Confirm new password').fill('different-password');
        await page.getByRole('button', { name: 'Reset password' }).click();
        await expect(page.getByText('Passwords do not match')).toBeVisible();
    });

    test('reset password with an invalid token shows invalid link message', async ({ page }) => {
        await page.goto('/reset-password?token=invalid-token');
        await page.getByPlaceholder('New password', { exact: true }).fill('new-password-123');
        await page.getByPlaceholder('Confirm new password').fill('new-password-123');
        await page.getByRole('button', { name: 'Reset password' }).click();
        await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
    });
});

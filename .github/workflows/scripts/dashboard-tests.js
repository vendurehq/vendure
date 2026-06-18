const { chromium } = require('playwright');

/**
 * This script is run as part of the "publish & install" workflow, and performs
 * browser-based tests of the Vendure Dashboard to ensure it loads and login works.
 */
async function runDashboardTests() {
    console.log('Starting dashboard tests...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    let page;

    try {
        page = await browser.newPage();

        // Navigate to the dashboard
        console.log('Navigating to dashboard...');
        await page.goto('http://localhost:5173/dashboard');

        // Wait for the page to load
        await page.waitForLoadState('networkidle');

        // Check if the login form is present
        console.log('Checking for login form...');
        const loginForm = await page.locator('form').first();
        if (!loginForm) {
            throw new Error('Login form not found');
        }

        // Fill in login credentials - try multiple selectors
        console.log('Filling login credentials...');
        const usernameInput = await page
            .locator(
                'input[name="username"], input[type="text"], input[placeholder*="username"], input[placeholder*="Username"]',
            )
            .first();
        const passwordInput = await page
            .locator(
                'input[name="password"], input[type="password"], input[placeholder*="password"], input[placeholder*="Password"]',
            )
            .first();

        if (!usernameInput || !passwordInput) {
            throw new Error('Username or password input fields not found');
        }

        await usernameInput.fill('superadmin');
        await passwordInput.fill('superadmin');

        // Submit the form - try multiple selectors
        console.log('Submitting login form...');
        const submitButton = await page
            .locator(
                'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")',
            )
            .first();
        if (!submitButton) {
            throw new Error('Submit button not found');
        }
        await submitButton.click();

        // Wait for navigation after login
        await page.waitForLoadState('networkidle');

        // Check if we're logged in by looking for admin dashboard elements
        console.log('Verifying successful login...');

        // Wait for dashboard elements to appear with a more robust approach
        const dashboardSelectors = ['h1:has-text("Insights")'];

        // Try to wait for any dashboard element to appear
        let dashboardElement = null;
        let foundSelector = null;

        for (const selector of dashboardSelectors) {
            try {
                // Wait up to 10 seconds for each selector
                await page.waitForSelector(selector, { timeout: 10000 });
                dashboardElement = await page.locator(selector).first();
                if (dashboardElement && (await dashboardElement.count()) > 0) {
                    foundSelector = selector;
                    console.log(`Found dashboard element with selector: ${selector}`);
                    break;
                }
            } catch (e) {
                // Continue to next selector
                console.log(`Selector ${selector} not found, trying next...`);
            }
        }

        if (!foundSelector) {
            // Fallback: check if we're still on a login page
            const currentUrl = page.url();
            const pageContent = await page.content();

            if (
                currentUrl.includes('login') ||
                currentUrl.includes('auth') ||
                pageContent.includes('login') ||
                pageContent.includes('Login')
            ) {
                throw new Error('Login failed - still on login page');
            }

            // If we're not on login page, assume login was successful
            console.log('Login appears successful - not on login page');
        } else {
            console.log('Dashboard loaded successfully');
        }

        // Take a screenshot for debugging
        await page.screenshot({ path: '/tmp/dashboard-test-login.png' });
        console.log('Screenshot saved to /tmp/dashboard-test-login.png');

        // navigate to the product list page by first expanding the "Catalog" section
        // and then clicking the "Products" link in the sidebar
        console.log('Expanding Catalog section...');
        const catalogSection = await page.locator('button:has-text("Catalog")').first();
        if (!catalogSection) {
            throw new Error('Catalog section not found');
        }
        await catalogSection.click();

        // Wait for the section to expand and Products link to be visible
        console.log('Waiting for Products link to be visible...');
        await page.waitForSelector('a:has-text("Products")', { timeout: 5000 });
        
        const productsLink = await page.locator('a:has-text("Products")').first();
        if (!productsLink) {
            throw new Error('Products link not found after expanding Catalog section');
        }
        await productsLink.click();

        // wait for the page to load and verify we're on the Products page
        await page.waitForLoadState('networkidle');

        // Wait for the Products page H1 to appear
        console.log('Waiting for Products page to load...');
        try {
            await page.waitForSelector('h1:has-text("Products")', { timeout: 10000 });
            console.log('Products page loaded successfully');
        } catch (e) {
            throw new Error('Products page did not load - H1 with "Products" text not found');
        }

        // get a list of the products in the product list page
        const products = await page.locator('tbody tr').all();
        console.log(`Found ${products.length} products`);

        // Take a screenshot for debugging
        await page.screenshot({ path: '/tmp/dashboard-test-products.png' });
        console.log('Screenshot saved to /tmp/dashboard-test-products.png');

        if (products.length !== 10) {
            throw new Error('Expected 10 products, but found ' + products.length);
        }

        // Check for the test component from our plugin
        console.log('Checking for dashboard extensiontest component...');
        try {
            await page.waitForSelector('div[data-testid="test-component"]', { timeout: 5000 });
            console.log('Test component found successfully');
        } catch (e) {
            throw new Error('Test component not found - div with data-testid="test-component" is missing');
        }

        console.log('Dashboard tests passed!');
    } catch (error) {
        console.error('Dashboard test failed:', error.message);
        // Take a screenshot on failure
        try {
            await page.screenshot({ path: '/tmp/dashboard-test-failure.png' });
            console.log('Failure screenshot saved to /tmp/dashboard-test-failure.png');
        } catch (screenshotError) {
            console.log('Could not save failure screenshot:', screenshotError.message);
        }
        throw error;
    } finally {
        await browser.close();
    }
}

// Main execution
async function main() {
    try {
        // Note: The workflow uses wait-on to ensure the dashboard is available
        // before running this script, so we can proceed directly to tests
        await runDashboardTests();
        process.exit(0);
    } catch (error) {
        console.error('Dashboard tests failed:', error);
        process.exit(1);
    }
}

main();

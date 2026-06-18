/* eslint-disable no-console */

/**
 * Checks the versions of the Angular compiler packages between the `admin-ui` and `ui-devkit` packages.
 * These must match exactly since using different packages can introduce errors when compiling
 * with the ui-devkit.
 * See https://github.com/vendurehq/vendure/issues/758 for more on this issue.
 */
async function checkAngularVersions() {
    const adminUiPackageJson = require('../packages/admin-ui/package.json');
    const uiDevkitPackageJson = require('../packages/ui-devkit/package.json');

    const angularCompilerPackages = ['@angular/cli', '@angular/compiler-cli', '@angular/compiler'];
    const illegalSemverPrefixes = /^[~^]/;
    const errors: string[] = [];

    for (const pkg of angularCompilerPackages) {
        const uiVersion =
            adminUiPackageJson.devDependencies[pkg as keyof typeof adminUiPackageJson.devDependencies];
        const devkitVersion =
            uiDevkitPackageJson.dependencies[pkg as keyof typeof uiDevkitPackageJson.dependencies];

        // Removing this restriction to allow more flexibility in keeping angular versions
        // current for end-users, and also preventing issues in monorepos.
        // if (illegalSemverPrefixes.test(uiVersion)) {
        //     errors.push(`Angular compiler versions must be exact, got "${uiVersion}" in admin-ui package`);
        // }
        // if (illegalSemverPrefixes.test(devkitVersion)) {
        //     errors.push(
        //         `Angular compiler versions must be exact, got "${devkitVersion}" in ui-devkit package`,
        //     );
        // }

        if (uiVersion !== devkitVersion) {
            errors.push(
                `Angular compiler package mismatch [${pkg}] admin-ui: "${uiVersion}", ui-devkit: "${devkitVersion}"`,
            );
        }
    }
    if (errors.length) {
        for (const error of errors) {
            console.log(`ERROR: ${error}`);
        }
        process.exit(1);
    } else {
        console.log(`Angular compiler package check passed`);
        process.exit(0);
    }
}

checkAngularVersions();

import * as fs from 'fs-extra';
import path from 'node:path';

/**
 * Checks if the current working directory is a valid Vendure project directory.
 * This function centralizes the project validation logic used across CLI commands.
 */
export function isVendureProjectDirectory(): boolean {
    const cwd = process.cwd();

    const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
    const hasVendureConfig =
        fs.existsSync(path.join(cwd, 'vendure-config.ts')) ||
        fs.existsSync(path.join(cwd, 'vendure-config.js')) ||
        fs.existsSync(path.join(cwd, 'src/vendure-config.ts')) ||
        fs.existsSync(path.join(cwd, 'src/vendure-config.js'));

    if (hasPackageJson) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
            const hasVendureDeps = Object.keys(dependencies).some(
                dep => dep.includes('@vendure/') || dep === 'vendure',
            );

            return hasVendureDeps && hasVendureConfig;
        } catch {
            return false;
        }
    }

    return false;
}

export function validateVendureProjectDirectory(): void {
    if (!isVendureProjectDirectory()) {
        throw new Error(
            'Error: Not in a Vendure project directory. Please run this command from your Vendure project root.',
        );
    }
}

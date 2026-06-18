import { note } from '@clack/prompts';
import spawn from 'cross-spawn';
import fs from 'fs-extra';
import path from 'path';
import { Project } from 'ts-morph';

import { findPackageJsonWithDependency } from '../utilities/monorepo-utils';

export interface PackageToInstall {
    pkg: string;
    version?: string;
    isDevDependency?: boolean;
    installInRoot?: boolean;
}

export class PackageJson {
    private _vendurePackageJsonPath: string | undefined;
    private _rootPackageJsonPath: string | undefined;
    constructor(private readonly project: Project) {}

    get vendurePackageJsonPath() {
        return this.locatePackageJsonWithVendureDependency();
    }

    get rootPackageJsonPath() {
        return this.locateRootPackageJson();
    }

    determineVendureVersion(): string | undefined {
        const packageJson = this.getPackageJsonContent();
        return packageJson && packageJson.dependencies['@vendure/core'];
    }

    async installPackages(requiredPackages: PackageToInstall[]) {
        const packageJson = this.getPackageJsonContent();
        if (!packageJson) {
            return;
        }
        const packagesToInstall = requiredPackages.filter(({ pkg, version, isDevDependency }) => {
            const hasDependency = isDevDependency
                ? packageJson.devDependencies[pkg]
                : packageJson.dependencies[pkg];
            return !hasDependency;
        });

        const depsToInstall = packagesToInstall
            .filter(p => !p.isDevDependency && packageJson.dependencies?.[p.pkg] === undefined)
            .map(p => `${p.pkg}${p.version ? `@${p.version}` : ''}`);
        const devDepsToInstall = packagesToInstall
            .filter(p => p.isDevDependency && packageJson.devDependencies?.[p.pkg] === undefined)
            .map(p => `${p.pkg}${p.version ? `@${p.version}` : ''}`);
        if (depsToInstall.length) {
            await this.runPackageManagerInstall(depsToInstall, false);
        }
        if (devDepsToInstall.length) {
            await this.runPackageManagerInstall(devDepsToInstall, true);
        }
    }

    getPackageJsonContent(): Record<string, any> | false {
        const packageJsonPath = this.locatePackageJsonWithVendureDependency();
        if (!packageJsonPath || !fs.existsSync(packageJsonPath)) {
            note(
                `Could not find a package.json in the current directory. Please run this command from the root of a Vendure project.`,
            );
            return false;
        }
        return fs.readJsonSync(packageJsonPath);
    }

    /**
     * @description
     * The Root package json can be different from the "vendure" package json when in a monorepo
     * setup.
     */
    getRootPackageJsonContent(): Record<string, any> | false {
        const packageJsonPath = this.locateRootPackageJson();
        if (!packageJsonPath || !fs.existsSync(packageJsonPath)) {
            note(
                `Could not find root package.json in the current directory. Please run this command from the root of an npm project.`,
            );
            return false;
        }
        return fs.readJsonSync(packageJsonPath);
    }

    determinePackageManager(): 'yarn' | 'npm' | 'pnpm' {
        const rootDir = this.getPackageRootDir().getPath();
        const yarnLockPath = path.join(rootDir, 'yarn.lock');
        const npmLockPath = path.join(rootDir, 'package-lock.json');
        const pnpmLockPath = path.join(rootDir, 'pnpm-lock.yaml');
        if (fs.existsSync(yarnLockPath)) {
            return 'yarn';
        }
        if (fs.existsSync(npmLockPath)) {
            return 'npm';
        }
        if (fs.existsSync(pnpmLockPath)) {
            return 'pnpm';
        }
        return 'npm';
    }

    /**
     * Adds a script to the "vendure" package.json, which can differ from the root
     * package.json if in a monorepo.
     */
    addScriptToVendurePackageJson(scriptName: string, script: string) {
        const packageJson = this.getPackageJsonContent();
        if (packageJson) {
            packageJson.scripts = packageJson.scripts || {};
            packageJson.scripts[scriptName] = script;
            const packageJsonPath = this.vendurePackageJsonPath;
            if (packageJsonPath) {
                fs.writeJsonSync(packageJsonPath, packageJson, { spaces: 2 });
            }
        }
    }

    /**
     * @description
     * The Root package json can be different from the "vendure" package json when in a monorepo
     * setup.
     */
    addScriptToRootPackageJson(scriptName: string, script: string) {
        const packageJson = this.getRootPackageJsonContent();
        if (packageJson) {
            packageJson.scripts = packageJson.scripts || {};
            packageJson.scripts[scriptName] = script;
            const packageJsonPath = this.rootPackageJsonPath;
            if (packageJsonPath) {
                fs.writeJsonSync(packageJsonPath, packageJson, { spaces: 2 });
            }
        }
    }

    getPackageRootDir() {
        const rootDir = this.project.getDirectory('.');
        if (!rootDir) {
            throw new Error('Could not find the root directory of the project');
        }
        return rootDir;
    }

    locateRootPackageJson() {
        if (this._rootPackageJsonPath) {
            return this._rootPackageJsonPath;
        }
        const rootDir = this.getPackageRootDir().getPath();
        const rootPackageJsonPath = path.join(rootDir, 'package.json');
        if (fs.existsSync(rootPackageJsonPath)) {
            this._rootPackageJsonPath = rootPackageJsonPath;
            return rootPackageJsonPath;
        }
        return null;
    }

    locatePackageJsonWithVendureDependency() {
        if (this._vendurePackageJsonPath) {
            return this._vendurePackageJsonPath;
        }
        const rootDir = this.getPackageRootDir().getPath();
        const packageJsonPath = findPackageJsonWithDependency(rootDir, '@vendure/core');

        if (packageJsonPath) {
            this._vendurePackageJsonPath = packageJsonPath;
        }

        return packageJsonPath;
    }

    private async runPackageManagerInstall(dependencies: string[], isDev: boolean) {
        return new Promise<void>((resolve, reject) => {
            const packageManager = this.determinePackageManager();
            let command = '';
            let args: string[] = [];
            if (packageManager === 'yarn') {
                command = 'yarnpkg';
                args = ['add', '--exact', '--ignore-engines'];
                if (isDev) {
                    args.push('--dev');
                }

                args = args.concat(dependencies);
            } else if (packageManager === 'pnpm') {
                command = 'pnpm';
                args = ['add', '--save-exact'].concat(dependencies);
                if (isDev) {
                    args.push('--save-dev', '--workspace-root');
                }
            } else {
                command = 'npm';
                args = ['install', '--save', '--save-exact', '--loglevel', 'error'].concat(dependencies);
                if (isDev) {
                    args.push('--save-dev');
                }
            }
            const child = spawn(command, args, { stdio: 'ignore' });
            child.on('close', code => {
                if (code !== 0) {
                    const message = 'An error occurred when installing dependencies.';
                    reject({
                        message,
                        command: `${command} ${args.join(' ')}`,
                    });
                    return;
                }
                resolve();
            });
        });
    }
}

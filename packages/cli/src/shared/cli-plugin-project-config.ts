import fs from 'fs-extra';
import path from 'node:path';

import { PackageJsonLike, resolveCliProjectRoot } from './resolve-cli-plugins';

export interface CliPluginProjectConfigWriteResult {
    packageJsonPath: string;
    plugins: string[];
    exclude: string[];
}

/**
 * Detects the indentation used in a JSON file so rewrites preserve formatting.
 */
export function detectJsonIndent(raw: string): string | number {
    const match = /^( +|\t+)/m.exec(raw);
    if (!match) {
        return 2;
    }
    return match[1].includes('\t') ? '\t' : match[1].length;
}

/**
 * Reads the project package.json used for CLI plugin configuration.
 */
export function readCliProjectPackageJson(cwd: string = process.cwd()): {
    projectRoot: string;
    packageJsonPath: string;
    packageJson: PackageJsonLike;
    raw: string;
} | null {
    const projectRoot = resolveCliProjectRoot(cwd);
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return null;
    }
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    try {
        return {
            projectRoot,
            packageJsonPath,
            packageJson: JSON.parse(raw) as PackageJsonLike,
            raw,
        };
    } catch {
        return null;
    }
}

/**
 * Updates `vendure.cli.plugins` / `vendure.cli.exclude` while preserving
 * package.json indentation and trailing-newline convention.
 */
export function writeCliPluginProjectConfig(options: {
    cwd?: string;
    plugins: string[];
    exclude: string[];
}): CliPluginProjectConfigWriteResult {
    const project = readCliProjectPackageJson(options.cwd);
    if (!project) {
        throw new Error('Could not find a project package.json to update CLI plugin configuration.');
    }

    const nextPackageJson: PackageJsonLike = {
        ...project.packageJson,
        vendure: {
            ...project.packageJson.vendure,
            cli: {
                ...project.packageJson.vendure?.cli,
                plugins: options.plugins,
                exclude: options.exclude,
            },
        },
    };

    // Drop empty exclude to keep package.json tidy; keep plugins even when empty
    // so the project stays in explicit-activation mode after the first write.
    if (nextPackageJson.vendure?.cli?.exclude?.length === 0) {
        delete nextPackageJson.vendure.cli.exclude;
    }

    const indent = detectJsonIndent(project.raw);
    const trailingNewline = project.raw.endsWith('\n') ? '\n' : '';
    const serialized = `${JSON.stringify(nextPackageJson, null, indent)}${trailingNewline}`;
    fs.writeFileSync(project.packageJsonPath, serialized, 'utf8');

    return {
        packageJsonPath: project.packageJsonPath,
        plugins: options.plugins,
        exclude: options.exclude,
    };
}

/**
 * Enables a CLI plugin package in the project package.json.
 */
export function addCliPluginToProjectConfig(
    packageName: string,
    cwd: string = process.cwd(),
): CliPluginProjectConfigWriteResult {
    const project = readCliProjectPackageJson(cwd);
    if (!project) {
        throw new Error('Could not find a project package.json to update CLI plugin configuration.');
    }

    const currentPlugins = [...(project.packageJson.vendure?.cli?.plugins ?? [])];
    const currentExclude = [...(project.packageJson.vendure?.cli?.exclude ?? [])];

    if (!currentPlugins.includes(packageName)) {
        currentPlugins.push(packageName);
    }
    const exclude = currentExclude.filter(name => name !== packageName);

    return writeCliPluginProjectConfig({
        cwd,
        plugins: currentPlugins,
        exclude,
    });
}

/**
 * Disables a CLI plugin package by removing it from the allowlist and adding
 * it to `vendure.cli.exclude` so discovery hints stay quiet.
 */
export function removeCliPluginFromProjectConfig(
    packageName: string,
    cwd: string = process.cwd(),
): CliPluginProjectConfigWriteResult {
    const project = readCliProjectPackageJson(cwd);
    if (!project) {
        throw new Error('Could not find a project package.json to update CLI plugin configuration.');
    }

    const plugins = (project.packageJson.vendure?.cli?.plugins ?? []).filter(name => name !== packageName);
    const exclude = [...(project.packageJson.vendure?.cli?.exclude ?? [])];
    if (!exclude.includes(packageName)) {
        exclude.push(packageName);
    }

    return writeCliPluginProjectConfig({
        cwd,
        plugins,
        exclude,
    });
}

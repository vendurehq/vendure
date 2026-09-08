import fs from 'fs-extra';
import path from 'node:path';

import { PackageJsonLike, resolveCliProjectRoot } from './resolve-cli-plugins';

export interface CliPluginProjectConfigWriteResult {
    packageJsonPath: string;
    plugins: string[];
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
 * Merges an interactive selection into the current allowlist without losing
 * entries that were not offered for toggling (e.g. plugins that currently
 * fail to resolve). Preserves the order of existing entries because allowlist
 * order determines command override precedence.
 */
export function mergeEnabledPluginSelection(
    currentPlugins: string[],
    toggleablePlugins: string[],
    selectedPlugins: string[],
): string[] {
    const toggleable = new Set(toggleablePlugins);
    const selected = new Set(selectedPlugins);
    const next = currentPlugins.filter(name => !toggleable.has(name) || selected.has(name));
    for (const name of selectedPlugins) {
        if (!next.includes(name)) {
            next.push(name);
        }
    }
    return next;
}

/**
 * Updates `vendure.cli.plugins` while preserving package.json indentation,
 * line endings and trailing-newline convention.
 */
export function writeCliPluginProjectConfig(options: {
    cwd?: string;
    plugins: string[];
}): CliPluginProjectConfigWriteResult {
    const project = readCliProjectPackageJson(options.cwd);
    if (!project) {
        throw new Error('Could not find a project package.json to update CLI plugin configuration.');
    }

    // Keep plugins even when empty so the project stays in explicit-activation
    // mode after the first write.
    const nextPackageJson: PackageJsonLike = {
        ...project.packageJson,
        vendure: {
            ...project.packageJson.vendure,
            cli: {
                ...project.packageJson.vendure?.cli,
                plugins: options.plugins,
            },
        },
    };

    const indent = detectJsonIndent(project.raw);
    const useCrlf = project.raw.includes('\r\n');
    let serialized = JSON.stringify(nextPackageJson, null, indent);
    if (useCrlf) {
        serialized = serialized.replace(/\n/g, '\r\n');
    }
    if (project.raw.endsWith('\n')) {
        serialized += useCrlf ? '\r\n' : '\n';
    }
    fs.writeFileSync(project.packageJsonPath, serialized, 'utf8');

    return {
        packageJsonPath: project.packageJsonPath,
        plugins: options.plugins,
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

    const plugins = [...(project.packageJson.vendure?.cli?.plugins ?? [])];
    if (!plugins.includes(packageName)) {
        plugins.push(packageName);
    }

    return writeCliPluginProjectConfig({ cwd, plugins });
}

/**
 * Disables a CLI plugin package by removing it from the allowlist. Since
 * loading is opt-in, removal is simply not being listed.
 */
export function removeCliPluginFromProjectConfig(
    packageName: string,
    cwd: string = process.cwd(),
): CliPluginProjectConfigWriteResult {
    const project = readCliProjectPackageJson(cwd);
    if (!project) {
        throw new Error('Could not find a project package.json to update CLI plugin configuration.');
    }

    const plugins = (project.packageJson.vendure?.cli?.plugins ?? []).filter(
        name => name !== packageName,
    );

    return writeCliPluginProjectConfig({ cwd, plugins });
}

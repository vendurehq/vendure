import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';

import { MONOREPO_PACKAGE_DIRS } from '../../utilities/monorepo-utils';

import { exactObjectValue, nonEmptyString, uuid } from './project-link-validation';

export const PROJECT_LINK_MANIFEST_RELATIVE_PATH = path.join('.vendure', 'project.json');

export interface ProjectLinkManifest {
    schemaVersion: 1;
    project: { id: string; name: string };
    account: { id: string; name: string };
    link: { id: string; protocolVersion: 1 };
}

export type ManifestReadResult =
    | { kind: 'missing'; path: string }
    | { kind: 'valid'; path: string; manifest: ProjectLinkManifest }
    | { kind: 'invalid'; path: string; reason: string };

export interface AtomicFileOperations {
    mkdir: typeof fsPromises.mkdir;
    open: typeof fsPromises.open;
    rename: typeof fsPromises.rename;
    unlink: typeof fsPromises.unlink;
}

const defaultFileOperations: AtomicFileOperations = {
    mkdir: fsPromises.mkdir,
    open: fsPromises.open,
    rename: fsPromises.rename,
    unlink: fsPromises.unlink,
};

export function resolveProjectRoot(cwd: string, selectedProject?: string): string {
    const resolvedCwd = realDirectory(cwd, 'Current working directory');
    let projectRoot: string;

    if (selectedProject) {
        projectRoot = realDirectory(path.resolve(resolvedCwd, selectedProject), 'Selected project');
        assertVendureProject(projectRoot);
    } else {
        const nearest = findNearestVendureProject(resolvedCwd);
        if (nearest) {
            projectRoot = nearest;
        } else {
            const candidates = findWorkspaceVendureProjects(resolvedCwd);
            if (candidates.length === 0) {
                throw new Error(
                    'Could not find a Vendure project. Run this command from a project that depends on @vendure/core, or pass --project <path>.',
                );
            }
            if (candidates.length > 1) {
                throw new Error(
                    `Multiple Vendure projects were found:\n${candidates
                        .map(candidate => `   ${candidate}`)
                        .join('\n')}\nRun the command again with --project <path>.`,
                );
            }
            projectRoot = candidates[0];
        }
    }

    assertNoCrossRootManifest(resolvedCwd, projectRoot);
    return projectRoot;
}

export function getProjectLinkManifestPath(projectRoot: string): string {
    return path.join(projectRoot, PROJECT_LINK_MANIFEST_RELATIVE_PATH);
}

export function readProjectLinkManifest(projectRoot: string): ManifestReadResult {
    const manifestPath = getProjectLinkManifestPath(projectRoot);
    if (!fs.existsSync(manifestPath)) {
        return { kind: 'missing', path: manifestPath };
    }

    let value: unknown;
    try {
        value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return {
            kind: 'invalid',
            path: manifestPath,
            reason: 'The file is not valid JSON.',
        };
    }
    try {
        return { kind: 'valid', path: manifestPath, manifest: parseProjectLinkManifest(value) };
    } catch (error) {
        return {
            kind: 'invalid',
            path: manifestPath,
            reason: error instanceof Error ? error.message : 'The manifest is invalid.',
        };
    }
}

export function parseProjectLinkManifest(value: unknown, expectedLinkId?: string): ProjectLinkManifest {
    const root = exactObject(value, ['schemaVersion', 'project', 'account', 'link'], 'manifest');
    if (root.schemaVersion !== 1) {
        throw new Error('The manifest schemaVersion must be 1.');
    }

    const project = identityObject(root.project, 'project');
    const account = identityObject(root.account, 'account');
    const link = exactObject(root.link, ['id', 'protocolVersion'], 'link');
    const linkId = uuid(link.id, 'The link.id must be a UUID.');
    if (link.protocolVersion !== 1) {
        throw new Error('The manifest link.protocolVersion must be 1.');
    }
    if (expectedLinkId && linkId !== expectedLinkId) {
        throw new Error('The approved manifest does not match the created link request.');
    }

    return {
        schemaVersion: 1,
        project,
        account,
        link: { id: linkId, protocolVersion: 1 },
    };
}

export async function writeProjectLinkManifestAtomic(
    projectRoot: string,
    manifest: ProjectLinkManifest,
    operations: AtomicFileOperations = defaultFileOperations,
): Promise<string> {
    const manifestPath = getProjectLinkManifestPath(projectRoot);
    const manifestDir = path.dirname(manifestPath);
    const temporaryPath = path.join(manifestDir, `.project-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof fsPromises.open>> | undefined;

    try {
        await operations.mkdir(manifestDir, { recursive: true });
        handle = await operations.open(temporaryPath, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await operations.rename(temporaryPath, manifestPath);
        return manifestPath;
    } catch (error) {
        if (handle) {
            await handle.close().catch(() => undefined);
        }
        await operations.unlink(temporaryPath).catch(() => undefined);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not write ${manifestPath} atomically: ${detail}`);
    }
}

export function removeProjectLinkManifest(projectRoot: string): void {
    fs.unlinkSync(getProjectLinkManifestPath(projectRoot));
}

function findNearestVendureProject(start: string): string | undefined {
    let current = start;
    while (true) {
        if (hasVendureCoreDependency(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

function findWorkspaceVendureProjects(root: string): string[] {
    const candidates = new Set<string>();
    for (const packageDir of MONOREPO_PACKAGE_DIRS) {
        const container = path.join(root, packageDir);
        if (!fs.existsSync(container)) {
            continue;
        }
        for (const entry of fs.readdirSync(container, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }
            const candidate = path.join(container, entry.name);
            if (hasVendureCoreDependency(candidate)) {
                candidates.add(fs.realpathSync(candidate));
                continue;
            }
            if (entry.name.startsWith('@')) {
                for (const scopedEntry of fs.readdirSync(candidate, { withFileTypes: true })) {
                    if (!scopedEntry.isDirectory()) {
                        continue;
                    }
                    const scopedCandidate = path.join(candidate, scopedEntry.name);
                    if (hasVendureCoreDependency(scopedCandidate)) {
                        candidates.add(fs.realpathSync(scopedCandidate));
                    }
                }
            }
        }
    }
    return [...candidates].sort((a, b) => a.localeCompare(b));
}

function assertNoCrossRootManifest(cwd: string, projectRoot: string): void {
    const targetManifest = getProjectLinkManifestPath(projectRoot);
    const boundary = findManifestSearchBoundary(cwd, projectRoot);
    let current = cwd;
    while (true) {
        const ancestorManifest = getProjectLinkManifestPath(current);
        if (
            fs.existsSync(ancestorManifest) &&
            path.resolve(ancestorManifest) !== path.resolve(targetManifest)
        ) {
            throw new Error(
                [
                    'A Project Link Manifest exists outside the selected Vendure project.',
                    `   Existing: ${ancestorManifest}`,
                    `   Selected: ${projectRoot}`,
                    'Run the command from the intended project directory.',
                ].join('\n'),
            );
        }
        if (current === boundary) {
            return;
        }
        current = path.dirname(current);
    }
}

function findManifestSearchBoundary(cwd: string, projectRoot: string): string {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot && pathsOverlap(gitRoot, projectRoot)) {
        return gitRoot;
    }
    if (isPathWithin(cwd, projectRoot)) {
        return cwd;
    }
    if (isPathWithin(projectRoot, cwd)) {
        return projectRoot;
    }
    return cwd;
}

export function findGitRoot(start: string): string | undefined {
    let current = start;
    while (true) {
        if (fs.existsSync(path.join(current, '.git'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

function pathsOverlap(first: string, second: string): boolean {
    return isPathWithin(first, second) || isPathWithin(second, first);
}

function isPathWithin(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return (
        relative === '' ||
        (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
}

function assertVendureProject(projectRoot: string): void {
    if (!hasVendureCoreDependency(projectRoot)) {
        throw new Error(`${projectRoot} is not a Vendure project with a direct @vendure/core dependency.`);
    }
}

function hasVendureCoreDependency(projectRoot: string): boolean {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return false;
    }
    try {
        const packageJson = fs.readJsonSync(packageJsonPath);
        return Boolean(
            packageJson.dependencies?.['@vendure/core'] ??
            packageJson.devDependencies?.['@vendure/core'] ??
            packageJson.optionalDependencies?.['@vendure/core'],
        );
    } catch {
        return false;
    }
}

function realDirectory(directory: string, label: string): string {
    try {
        const realPath = fs.realpathSync(directory);
        if (!fs.statSync(realPath).isDirectory()) {
            throw new Error('not a directory');
        }
        return realPath;
    } catch {
        throw new Error(`${label} does not exist or is not a directory: ${directory}`);
    }
}

function identityObject(value: unknown, label: string): { id: string; name: string } {
    const object = exactObject(value, ['id', 'name'], label);
    return {
        id: uuid(object.id, `The ${label}.id must be a UUID.`),
        name: nonEmptyString(object.name, `The ${label}.name must be a non-empty string.`),
    };
}

function exactObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
    return exactObjectValue(
        value,
        keys,
        `The ${label} must be an object.`,
        `The ${label} contains unexpected or missing fields.`,
    );
}

import fs from 'fs-extra';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { LINK_ID, OTHER_LINK_ID, manifest } from './console.fixtures';
import {
    ProjectLinkManifest,
    getProjectLinkManifestPath,
    parseProjectLinkManifest,
    readProjectLinkManifest,
    resolveProjectRoot,
    writeProjectLinkManifestAtomic,
} from './project-link-manifest';

const UUID_V7_LINK_ID = '55555555-5555-7555-8555-555555555555';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('Project Link Manifest', () => {
    it('parses and reconstructs the exact v1 contract', () => {
        expect(parseProjectLinkManifest(structuredClone(manifest), LINK_ID)).toEqual(manifest);
    });

    it('rejects unexpected fields and a mismatched link ID', () => {
        expect(() => parseProjectLinkManifest({ ...manifest, pollingSecret: 'secret' })).toThrow(
            'unexpected or missing fields',
        );
        expect(() => parseProjectLinkManifest(manifest, OTHER_LINK_ID)).toThrow(
            'does not match the created link request',
        );
    });

    it('accepts UUIDs without restricting the server to version 4', () => {
        const versionSevenManifest: ProjectLinkManifest = {
            ...manifest,
            project: { ...manifest.project, id: UUID_V7_LINK_ID },
        };

        expect(parseProjectLinkManifest(versionSevenManifest)).toEqual(versionSevenManifest);
    });

    it('reports malformed JSON without including file contents', () => {
        const root = vendureProject();
        const manifestPath = getProjectLinkManifestPath(root);
        fs.ensureDirSync(path.dirname(manifestPath));
        fs.writeFileSync(manifestPath, '{"pollingSecret":"do-not-print"');

        const result = readProjectLinkManifest(root);

        expect(result).toMatchObject({ kind: 'invalid', reason: 'The file is not valid JSON.' });
        expect(JSON.stringify(result)).not.toContain('do-not-print');
    });

    it('resolves the nearest ancestor Vendure project', () => {
        const root = vendureProject();
        const nested = path.join(root, 'src', 'plugins', 'example');
        fs.ensureDirSync(nested);

        expect(resolveProjectRoot(nested)).toBe(root);
    });

    it('resolves apps/vendure from the workspace root', () => {
        const workspace = temporaryDirectory();
        fs.ensureDirSync(path.join(workspace, '.git'));
        fs.writeJsonSync(path.join(workspace, 'package.json'), { private: true });
        const project = vendureProject(path.join(workspace, 'apps', 'vendure'));
        const nested = path.join(project, 'src');
        fs.ensureDirSync(nested);

        expect(resolveProjectRoot(workspace)).toBe(project);
        expect(resolveProjectRoot(nested)).toBe(project);
    });

    it('resolves one workspace project and rejects ambiguous workspaces', () => {
        const workspace = temporaryDirectory();
        fs.writeJsonSync(path.join(workspace, 'package.json'), { private: true });
        const first = vendureProject(path.join(workspace, 'apps', 'server'));

        expect(resolveProjectRoot(workspace)).toBe(first);

        vendureProject(path.join(workspace, 'packages', 'second-server'));
        expect(() => resolveProjectRoot(workspace)).toThrow('Multiple Vendure projects were found');
    });

    it('uses an explicit project and rejects an ancestor manifest for another root', () => {
        const workspace = temporaryDirectory();
        fs.writeJsonSync(path.join(workspace, 'package.json'), { private: true });
        const selected = vendureProject(path.join(workspace, 'apps', 'server'));
        const ancestorManifest = getProjectLinkManifestPath(workspace);
        fs.ensureDirSync(path.dirname(ancestorManifest));
        fs.writeJsonSync(ancestorManifest, manifest);

        expect(() => resolveProjectRoot(workspace, selected)).toThrow(
            'A Project Link Manifest exists outside the selected Vendure project',
        );
    });

    it('does not inspect manifests above the Git workspace boundary', () => {
        const outer = temporaryDirectory();
        const workspace = path.join(outer, 'workspace');
        fs.ensureDirSync(path.join(workspace, '.git'));
        const selected = vendureProject(path.join(workspace, 'apps', 'server'));
        const outerManifest = getProjectLinkManifestPath(outer);
        fs.ensureDirSync(path.dirname(outerManifest));
        fs.writeJsonSync(outerManifest, manifest);

        expect(resolveProjectRoot(workspace, selected)).toBe(selected);
    });

    it('atomically writes a manifest and preserves the old file if rename fails', async () => {
        const root = vendureProject();
        const manifestPath = await writeProjectLinkManifestAtomic(root, manifest);
        expect(fs.readJsonSync(manifestPath)).toEqual(manifest);

        const replacement: ProjectLinkManifest = {
            ...manifest,
            link: { id: OTHER_LINK_ID, protocolVersion: 1 },
        };
        await expect(
            writeProjectLinkManifestAtomic(root, replacement, {
                mkdir: fsPromises.mkdir,
                open: fsPromises.open,
                rename: () => Promise.reject(new Error('simulated rename failure')),
                unlink: fsPromises.unlink,
            }),
        ).rejects.toThrow('simulated rename failure');

        expect(fs.readJsonSync(manifestPath)).toEqual(manifest);
        expect(fs.readdirSync(path.dirname(manifestPath)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    });
});

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-manifest-'));
    temporaryDirectories.push(directory);
    return fs.realpathSync(directory);
}

function vendureProject(directory = temporaryDirectory()): string {
    fs.ensureDirSync(directory);
    fs.writeJsonSync(path.join(directory, 'package.json'), {
        dependencies: { '@vendure/core': '3.7.2' },
    });
    return fs.realpathSync(directory);
}

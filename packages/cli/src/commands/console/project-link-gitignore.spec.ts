import fs from 'fs-extra';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    PROJECT_LINK_IGNORE_CONTENTS,
    PROJECT_LINK_KEEP_MANIFEST,
    applyProjectLinkGitignoreRules,
    ensureProjectLinkGitignore,
    getProjectLinkGitignorePath,
} from './project-link-gitignore';

const temporaryDirectories: string[] = [];
const projectLinkRules = `${PROJECT_LINK_IGNORE_CONTENTS}\n${PROJECT_LINK_KEEP_MANIFEST}\n`;

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('Project Link gitignore', () => {
    it('creates the project gitignore when it is missing', () => {
        const root = temporaryDirectory();

        expect(ensureProjectLinkGitignore(root)).toEqual({
            kind: 'created',
            path: getProjectLinkGitignorePath(root),
        });
        expect(fs.readFileSync(getProjectLinkGitignorePath(root), 'utf8')).toBe(projectLinkRules);
    });

    it('replaces the scaffolded directory rule', () => {
        expect(applyProjectLinkGitignoreRules('node_modules\n.vendure/\ndist\n')).toBe(
            `node_modules\n${projectLinkRules}dist\n`,
        );
        expect(applyProjectLinkGitignoreRules('node_modules\n.vendure\ndist\n')).toBe(
            `node_modules\n${projectLinkRules}dist\n`,
        );
    });

    it('appends the rules when the scaffolded directory rule is absent', () => {
        expect(applyProjectLinkGitignoreRules('node_modules\ndist\n')).toBe(
            `node_modules\ndist\n\n${projectLinkRules}`,
        );
    });

    it('makes the manifest committable in a non-scaffolded project', () => {
        const root = temporaryDirectory();
        runGit(root, ['init', '--quiet']);
        fs.writeFileSync(getProjectLinkGitignorePath(root), 'node_modules\n');

        expect(ensureProjectLinkGitignore(root).kind).toBe('updated');
        expectGitIgnored(root, '.vendure/project.json', false);
        expectGitIgnored(root, '.vendure/cache.db', true);
    });

    it('leaves an already-correct gitignore unchanged', () => {
        const original = `node_modules\n${projectLinkRules}`;
        expect(applyProjectLinkGitignoreRules(original)).toBe(original);
    });

    it('does not treat similar patterns as the scaffolded rule', () => {
        const original = 'other-app/.vendure/\n**/.vendure/\n';
        expect(applyProjectLinkGitignoreRules(original)).toBe(`${original}\n${projectLinkRules}`);
    });

    it('preserves CRLF when updating an existing file', () => {
        expect(applyProjectLinkGitignoreRules('node_modules\r\n.vendure/\r\n')).toBe(
            `node_modules\r\n${PROJECT_LINK_IGNORE_CONTENTS}\r\n${PROJECT_LINK_KEEP_MANIFEST}\r\n`,
        );
    });

    it('updates only the project gitignore', () => {
        const workspace = temporaryDirectory();
        const project = path.join(workspace, 'apps', 'vendure');
        fs.ensureDirSync(project);
        fs.writeFileSync(path.join(workspace, '.gitignore'), '.vendure/\n');

        expect(ensureProjectLinkGitignore(project)).toEqual({
            kind: 'created',
            path: getProjectLinkGitignorePath(project),
        });
        expect(fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8')).toBe('.vendure/\n');
        expect(fs.readFileSync(getProjectLinkGitignorePath(project), 'utf8')).toBe(projectLinkRules);
    });

    it('reports a project gitignore that cannot be written', () => {
        const root = temporaryDirectory();
        fs.ensureDirSync(getProjectLinkGitignorePath(root));

        const result = ensureProjectLinkGitignore(root);

        expect(result.kind).toBe('failed');
        expect(result.path).toBe(getProjectLinkGitignorePath(root));
    });
});

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-gitignore-'));
    temporaryDirectories.push(directory);
    return fs.realpathSync(directory);
}

function expectGitIgnored(root: string, relativePath: string, ignored: boolean): void {
    fs.ensureFileSync(path.join(root, relativePath));
    const result = runGit(root, ['check-ignore', '--quiet', '--no-index', relativePath]);
    expect(result.status, result.stderr).toBe(ignored ? 0 : 1);
}

function runGit(root: string, args: string[]): ReturnType<typeof spawnSync> {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0 && args[0] !== 'check-ignore') {
        throw new Error(result.stderr);
    }
    return result;
}

import fs from 'fs-extra';
import path from 'node:path';

import { PROJECT_LINK_MANIFEST_RELATIVE_PATH } from './project-link-manifest';

export const PROJECT_LINK_GITIGNORE_RELATIVE_PATH = '.gitignore';
const PROJECT_LINK_MANIFEST_PATH = PROJECT_LINK_MANIFEST_RELATIVE_PATH.split(path.sep).join('/');
const PROJECT_LINK_DIRECTORY = path.posix.dirname(PROJECT_LINK_MANIFEST_PATH);
export const PROJECT_LINK_IGNORE_CONTENTS = `${PROJECT_LINK_DIRECTORY}/*`;
export const PROJECT_LINK_KEEP_MANIFEST = `!${PROJECT_LINK_MANIFEST_PATH}`;

export type ProjectLinkGitignoreResult =
    | { kind: 'unchanged'; path: string }
    | { kind: 'created'; path: string }
    | { kind: 'updated'; path: string }
    | { kind: 'failed'; path: string; reason: string };

export function getProjectLinkGitignorePath(projectRoot: string): string {
    return path.join(projectRoot, PROJECT_LINK_GITIGNORE_RELATIVE_PATH);
}

export function ensureProjectLinkGitignore(projectRoot: string): ProjectLinkGitignoreResult {
    const gitignorePath = getProjectLinkGitignorePath(projectRoot);

    try {
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, projectLinkRules('\n'), 'utf8');
            return { kind: 'created', path: gitignorePath };
        }

        const current = fs.readFileSync(gitignorePath, 'utf8');
        const next = applyProjectLinkGitignoreRules(current);
        if (next === current) {
            return { kind: 'unchanged', path: gitignorePath };
        }

        fs.writeFileSync(gitignorePath, next, 'utf8');
        return { kind: 'updated', path: gitignorePath };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { kind: 'failed', path: gitignorePath, reason };
    }
}

export function applyProjectLinkGitignoreRules(content: string): string {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const hasIgnoreRule = lines.includes(PROJECT_LINK_IGNORE_CONTENTS);
    const hasKeepRule = lines.includes(PROJECT_LINK_KEEP_MANIFEST);

    if (hasIgnoreRule && hasKeepRule) {
        return content;
    }

    const scaffoldRuleIndex = lines.findIndex(
        line => line === PROJECT_LINK_DIRECTORY || line === `${PROJECT_LINK_DIRECTORY}/`,
    );
    if (scaffoldRuleIndex !== -1) {
        lines.splice(scaffoldRuleIndex, 1, PROJECT_LINK_IGNORE_CONTENTS, PROJECT_LINK_KEEP_MANIFEST);
        return lines.join(newline);
    }

    let next = content;
    if (next.length > 0 && !next.endsWith('\n')) {
        next += newline;
    }
    if (next.length > 0 && !/(?:\r?\n){2}$/.test(next)) {
        next += newline;
    }
    return `${next}${projectLinkRules(newline)}`;
}

function projectLinkRules(newline: string): string {
    return `${PROJECT_LINK_IGNORE_CONTENTS}${newline}${PROJECT_LINK_KEEP_MANIFEST}${newline}`;
}

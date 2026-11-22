import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME_PATTERN = /^\s*at\s/;
const LOCATION_IN_PARENS_PATTERN = /\(([^()]+)\)\s*$/;
const BARE_LOCATION_PATTERN = /^\s*at\s+(?:async\s+)?(\S+)\s*$/;

/**
 * @description
 * Returns the frames of a stack trace which point at the project's own files: those under `cwd`
 * and not under a `node_modules` directory. Each frame is trimmed, and its file path is made
 * relative to `cwd`, for example `at OrderService.addItem (src/order.service.ts:12:5)`.
 *
 * The first line of a stack, the error message, is not a frame and is left out.
 */
export function trimStack(stack: string | undefined, cwd: string): string[] {
    if (!stack) {
        return [];
    }
    const root = path.resolve(cwd);
    const frames: string[] = [];
    for (const line of stack.split('\n')) {
        if (!FRAME_PATTERN.test(line)) {
            continue;
        }
        const location = LOCATION_IN_PARENS_PATTERN.exec(line)?.[1] ?? BARE_LOCATION_PATTERN.exec(line)?.[1];
        if (!location) {
            continue;
        }
        const file = parseLocation(location);
        if (!file) {
            continue;
        }
        const { filePath, written } = file;
        const relativePath = path.relative(root, filePath);
        const isUnderRoot =
            relativePath !== '' &&
            relativePath !== '..' &&
            !relativePath.startsWith('..' + path.sep) &&
            !path.isAbsolute(relativePath);
        if (!isUnderRoot || relativePath.split(path.sep).includes('node_modules')) {
            continue;
        }
        frames.push(line.trim().replace(written, relativePath));
    }
    return frames;
}

/**
 * Takes a frame location such as `/app/src/a.ts:1:2` or `file:///app/src/a.js:1:2` and returns the
 * file as written in the frame and as a path, or `undefined` for locations such as
 * `node:internal/...` or `<anonymous>`.
 */
function parseLocation(location: string): { written: string; filePath: string } | undefined {
    const written = location.replace(/:\d+(?::\d+)?$/, '');
    let filePath = written;
    if (written.startsWith('file://')) {
        try {
            filePath = fileURLToPath(written);
        } catch {
            return undefined;
        }
    }
    return path.isAbsolute(filePath) ? { written, filePath } : undefined;
}

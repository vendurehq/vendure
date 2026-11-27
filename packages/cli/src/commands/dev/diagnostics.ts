import path from 'node:path';

import { stripAnsi } from '../../shared/strip-ansi.js';

import { DevServerDiagnostic } from './state-file.js';

/** The most diagnostics kept from one failed start. */
const MAX_DIAGNOSTICS = 50;

// `src/index.ts(1,7): error TS2322: Type ...`, from tsc and ts-node.
const tscPlainPattern = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// `src/index.ts:1:7 - error TS2322: Type ...`, from tsc and ts-node with `pretty` on.
const tscPrettyPattern = /^(.+?):(\d+):(\d+) - error (TS\d+): (.*)$/;
// `Error:   x Expected ';'`, the first line of an SWC error block. Newer SWC versions print `×`.
const swcMessagePattern = /^(?:\w*Error:)?\s*[x×] (.+)$/;
// `   ,-[/project/src/index.ts:5:1]`, the file and the first line of the SWC code frame. SWC draws
// the frame with ASCII characters, or with box-drawing characters (`╭─[`, `│`, `·`, `╰─`) in its
// graphical mode.
const swcFramePattern = /^\s*(?:,-|╭─)\[(.+):(\d+):(\d+)\]$/;
// ` 5 |   return (1 + ;`, a source line of the SWC code frame.
const swcSourceLinePattern = /^\s*(\d+) [|│]/;
// `   :               ^`, the marker line under the source line with the error.
const swcMarkerPattern = /^\s*[:·] *[\^─┬]/;
// `   `----`, the end of the SWC code frame.
const swcFrameEndPattern = /^\s*(?:`-+|╰─+)$/;

/**
 * Reads the compile errors from the output of a server or worker process that failed to start.
 * It understands the errors that tsc and ts-node print, in plain and pretty form, and the error
 * blocks of the SWC transpiler. ANSI colours are ignored. A file inside the project directory is
 * reported relative to it.
 */
export function parseDiagnostics(output: string, projectDir?: string): DevServerDiagnostic[] {
    const lines = stripAnsi(output).split(/\r?\n/);
    const diagnostics: DevServerDiagnostic[] = [];
    const seen = new Set<string>();
    const add = (diagnostic: DevServerDiagnostic) => {
        const file = toProjectPath(diagnostic.file, projectDir);
        const key = `${file}:${diagnostic.line}:${diagnostic.column ?? ''}:${diagnostic.message}`;
        if (!seen.has(key) && diagnostics.length < MAX_DIAGNOSTICS) {
            seen.add(key);
            diagnostics.push({ ...diagnostic, file });
        }
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const tscMatch = tscPlainPattern.exec(line) ?? tscPrettyPattern.exec(line);
        if (tscMatch) {
            add({
                file: tscMatch[1].trim(),
                line: Number(tscMatch[2]),
                column: Number(tscMatch[3]),
                code: tscMatch[4],
                message: tscMatch[5].trim(),
            });
            continue;
        }
        const swcMatch = swcMessagePattern.exec(line);
        const frameMatch = swcMatch ? swcFramePattern.exec(lines[index + 1] ?? '') : null;
        if (swcMatch && frameMatch) {
            const location = readSwcErrorLocation(lines, index + 2);
            add({
                file: frameMatch[1],
                line: location?.line ?? Number(frameMatch[2]),
                column: location?.column ?? Number(frameMatch[3]),
                message: swcMatch[1].trim(),
            });
            index++;
        }
    }
    return diagnostics;
}

/**
 * Finds the line and column of an SWC error from its code frame. The frame's header names the
 * first line it shows, which is often not the line with the error, so the location is taken from
 * the source line just above the `^` marker.
 */
function readSwcErrorLocation(lines: string[], start: number): { line: number; column: number } | undefined {
    let previousSource: { line: number; pipeIndex: number } | undefined;
    for (let index = start; index < lines.length; index++) {
        const line = lines[index];
        if (swcFrameEndPattern.test(line)) {
            return;
        }
        const sourceMatch = swcSourceLinePattern.exec(line);
        if (sourceMatch) {
            previousSource = { line: Number(sourceMatch[1]), pipeIndex: line.search(/[|│]/) };
            continue;
        }
        if (previousSource && swcMarkerPattern.test(line)) {
            // The code starts two characters after the `|` of the source line, and the `:` of the
            // marker line sits in the same column as that `|`.
            const column = line.search(/[\^─┬]/) - previousSource.pipeIndex - 1;
            return { line: previousSource.line, column: Math.max(column, 1) };
        }
    }
}

function toProjectPath(file: string, projectDir: string | undefined): string {
    if (!projectDir || !path.isAbsolute(file)) {
        return file;
    }
    const relative = path.relative(projectDir, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative.split(path.sep).join('/')
        : file;
}

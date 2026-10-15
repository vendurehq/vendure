import { log } from '@clack/prompts';
import { Node, SourceFile } from 'ts-morph';

export const FLAG_PREFIX = '// TODO(vendure-v4):';

interface PendingFlag {
    lineStart: number;
    line: number;
    indent: string;
    messages: string[];
}

/**
 * Collects code the codemod cannot rewrite safely and marks it with a TODO comment above the
 * flagged line. Positions are read when a flag is added, so the file must not change between
 * the first `add()` and `apply()`.
 */
export class FlagCollector {
    private readonly pending = new Map<number, PendingFlag>();

    constructor(private readonly sourceFile: SourceFile) {}

    add(node: Node, message: string) {
        const text = this.sourceFile.getFullText();
        const lineStart = findCommentLineStart(node);
        const existing = this.pending.get(lineStart);
        if (existing) {
            if (!existing.messages.includes(message)) {
                existing.messages.push(message);
            }
            return;
        }
        const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? '';
        const line = this.sourceFile.getLineAndColumnAtPos(lineStart).line;
        this.pending.set(lineStart, { lineStart, line, indent, messages: [message] });
    }

    /**
     * Inserts the collected comments, skipping any already present from an earlier run, logs each
     * one, and returns the number inserted.
     */
    apply(): number {
        const text = this.sourceFile.getFullText();
        const filePath = this.sourceFile.getFilePath();
        const insertions: Array<{ lineStart: number; text: string; count: number }> = [];
        const flags = [...this.pending.values()].sort((a, b) => a.lineStart - b.lineStart);
        for (const flag of flags) {
            const commentsAbove = getCommentLinesAbove(text, flag.lineStart);
            const newMessages = flag.messages.filter(
                message => !commentsAbove.includes(`${FLAG_PREFIX} ${message}`),
            );
            for (const message of newMessages) {
                log.warn(`${filePath}:${flag.line} — ${message}`);
            }
            if (newMessages.length > 0) {
                insertions.push({
                    lineStart: flag.lineStart,
                    text: newMessages.map(message => `${flag.indent}${FLAG_PREFIX} ${message}\n`).join(''),
                    count: newMessages.length,
                });
            }
        }
        // Last first, so earlier positions stay valid
        for (const insertion of insertions.reverse()) {
            this.sourceFile.insertText(insertion.lineStart, insertion.text);
        }
        this.pending.clear();
        return insertions.reduce((sum, insertion) => sum + insertion.count, 0);
    }
}

/**
 * Finds the start of a line where a `//` comment can go above the node. A line that starts inside
 * a template literal or inside JSX would turn the comment into text, so the search moves up to the
 * enclosing template or outermost JSX element until it reaches a line where a comment is code.
 */
function findCommentLineStart(node: Node): number {
    const sourceFile = node.getSourceFile();
    const text = sourceFile.getFullText();
    let position = node.getStart();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const lineStart = text.lastIndexOf('\n', position - 1) + 1;
        const firstTokenPos = lineStart + (/^[ \t]*/.exec(text.slice(lineStart))?.[0].length ?? 0);
        const container = findEnclosingTextContainer(sourceFile, firstTokenPos);
        if (!container) {
            return lineStart;
        }
        position = container.getStart();
    }
}

function findEnclosingTextContainer(sourceFile: SourceFile, position: number): Node | undefined {
    const token = sourceFile.getDescendantAtPos(position);
    if (!token) {
        return undefined;
    }
    let outermost: Node | undefined;
    for (const candidate of [token, ...token.getAncestors()]) {
        const isTextContainer =
            Node.isTemplateExpression(candidate) ||
            Node.isNoSubstitutionTemplateLiteral(candidate) ||
            Node.isJsxElement(candidate) ||
            Node.isJsxSelfClosingElement(candidate) ||
            Node.isJsxFragment(candidate);
        if (isTextContainer && candidate.getStart() < position) {
            outermost = candidate;
        }
    }
    return outermost;
}

function getCommentLinesAbove(text: string, lineStart: number): string[] {
    const lines = text.slice(0, lineStart).split('\n');
    // The text ends with the newline before lineStart, so the last element is empty
    lines.pop();
    const comments: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (!trimmed.startsWith('//')) {
            break;
        }
        comments.push(trimmed);
    }
    return comments;
}

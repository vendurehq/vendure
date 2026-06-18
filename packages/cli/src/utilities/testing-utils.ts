import fs from 'fs-extra';
import { SourceFile } from 'ts-morph';
import { expect } from 'vitest';

export function expectSourceFileContentToMatch(sourceFile: SourceFile, expectedFilePath: string) {
    const result = sourceFile.getFullText();
    const expected = fs.readFileSync(expectedFilePath, 'utf-8');
    expect(normalizeLineFeeds(result)).toBe(normalizeLineFeeds(expected));
}

function normalizeLineFeeds(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

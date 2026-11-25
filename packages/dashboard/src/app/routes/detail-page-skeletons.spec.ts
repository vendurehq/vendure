import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The `pendingSkeleton` of a detail route lists the page's blocks by hand. These
 * checks read the route source and fail when the page's blocks change and the
 * skeleton does not.
 */

const ROUTES_DIR = path.join(import.meta.dirname, '_authenticated');

type Block = { blockId: string; column: string; conditional: boolean };

function routeFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'components' ? [] : routeFiles(file);
        }
        return /\.tsx$/.test(entry.name) && !/\.spec\./.test(entry.name) ? [file] : [];
    });
}

function parse(file: string) {
    return ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
}

function stringProperty(node: ts.ObjectLiteralExpression, name: string): string | undefined {
    for (const property of node.properties) {
        if (
            ts.isPropertyAssignment(property) &&
            property.name.getText() === name &&
            ts.isStringLiteral(property.initializer)
        ) {
            return property.initializer.text;
        }
    }
    return undefined;
}

/** The blocks of the `pendingSkeleton` object of a route, or undefined. */
function skeletonBlocks(source: ts.SourceFile): Array<{ blockId: string; column: string }> | undefined {
    let blocks: Array<{ blockId: string; column: string }> | undefined;
    const visit = (node: ts.Node) => {
        if (
            ts.isPropertyAssignment(node) &&
            node.name.getText() === 'pendingSkeleton' &&
            ts.isObjectLiteralExpression(node.initializer)
        ) {
            const list = node.initializer.properties.find(
                (p): p is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(p) && p.name.getText() === 'blocks',
            );
            if (list && ts.isArrayLiteralExpression(list.initializer)) {
                blocks = list.initializer.elements.filter(ts.isObjectLiteralExpression).map(element => ({
                    blockId: stringProperty(element, 'blockId') ?? '',
                    column: stringProperty(element, 'column') ?? '',
                }));
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return blocks;
}

function jsxAttribute(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
    for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText() === name) {
            return attribute.initializer && ts.isStringLiteral(attribute.initializer)
                ? attribute.initializer.text
                : undefined;
        }
    }
    return undefined;
}

/**
 * The `PageBlock`s a source file renders, in source order. A block is
 * conditional when anything but JSX lies between it and its parent element
 * (`{cond && <PageBlock>}`, a ternary, a render prop).
 */
function pageBlocks(source: ts.SourceFile): Block[] {
    const blocks: Block[] = [];
    const visit = (node: ts.Node) => {
        const opening = ts.isJsxElement(node)
            ? node.openingElement
            : ts.isJsxSelfClosingElement(node)
              ? node
              : undefined;
        if (opening && /^(PageBlock|FullWidthPageBlock)$/.test(opening.tagName.getText())) {
            const blockId = jsxAttribute(opening, 'blockId');
            if (blockId) {
                let parent = node.parent;
                let conditional = false;
                while (parent && !ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) {
                    if (!ts.isParenthesizedExpression(parent)) {
                        conditional = true;
                    }
                    parent = parent.parent;
                }
                const column =
                    opening.tagName.getText() === 'FullWidthPageBlock'
                        ? 'full'
                        : jsxAttribute(opening, 'column');
                blocks.push({ blockId, column: column ?? '', conditional });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return blocks;
}

/** The route file and the files of its own folder that it imports, which hold its page. */
function pageSources(file: string, source: ts.SourceFile): ts.SourceFile[] {
    const imported = source.statements
        .filter(ts.isImportDeclaration)
        .map(statement => (statement.moduleSpecifier as ts.StringLiteral).text)
        .filter(specifier => specifier.startsWith('./'))
        .map(specifier => path.join(path.dirname(file), specifier.replace(/\.js$/, '.tsx')))
        .filter(candidate => fs.existsSync(candidate));
    return [source, ...imported.map(parse)];
}

const routes = routeFiles(ROUTES_DIR)
    .map(file => {
        const source = parse(file);
        const skeleton = skeletonBlocks(source);
        return skeleton
            ? {
                  name: path.relative(ROUTES_DIR, file),
                  skeleton,
                  blocks: pageSources(file, source).flatMap(pageBlocks),
              }
            : undefined;
    })
    .filter(route => route !== undefined);

// OSS-1514 — the skeleton of a detail page has the page's own blocks
describe('detail page skeletons', () => {
    it('finds the skeletons of the detail routes', () => {
        expect(routes.length).toBeGreaterThan(25);
    });

    it.each(routes.map(route => [route.name, route] as const))(
        '%s lists blocks the page renders, in their columns and order',
        (_name, { skeleton, blocks }) => {
            const columns = ['main', 'side', 'full'];
            for (const block of skeleton) {
                expect(
                    blocks.some(b => b.blockId === block.blockId && b.column === block.column),
                    `${block.blockId} (${block.column}) is not a block of the page`,
                ).toBe(true);
            }
            for (const block of blocks.filter(b => !b.conditional)) {
                expect(
                    skeleton.some(s => s.blockId === block.blockId),
                    `the page always renders ${block.blockId}, the skeleton does not list it`,
                ).toBe(true);
            }
            for (const column of columns) {
                const ids = skeleton.filter(s => s.column === column).map(s => s.blockId);
                const pageOrder = blocks
                    .filter(b => b.column === column && ids.includes(b.blockId))
                    .map(b => b.blockId);
                expect(ids, `order of the ${column} column`).toEqual([...new Set(pageOrder)]);
            }
        },
    );
});

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

type Block = { blockId: string; column: string; conditional: boolean; entityType?: string };
type SkeletonBlock = { blockId: string; column: string; entityType?: string };

/** Components that render a `PageBlock` with a fixed `blockId` in the `column` they get. */
const WRAPPER_BLOCKS: Record<string, string> = {
    CustomFieldsPageBlock: 'custom-fields',
    RolesPageBlock: 'roles',
};

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

/** The `pendingSkeleton` object of a route: its blocks and the `pageId` it names. */
function skeletonOf(source: ts.SourceFile): { pageId?: string; blocks: SkeletonBlock[] } | undefined {
    let skeleton: { pageId?: string; blocks: SkeletonBlock[] } | undefined;
    const visit = (node: ts.Node) => {
        if (
            ts.isPropertyAssignment(node) &&
            node.name.getText() === 'pendingSkeleton' &&
            ts.isObjectLiteralExpression(node.initializer)
        ) {
            const object = node.initializer;
            const list = object.properties.find(
                (p): p is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(p) && p.name.getText() === 'blocks',
            );
            const pageIdProperty = object.properties.find(p => p.name?.getText() === 'pageId');
            skeleton = {
                pageId:
                    pageIdProperty && ts.isShorthandPropertyAssignment(pageIdProperty)
                        ? constString(source, 'pageId')
                        : stringProperty(object, 'pageId'),
                blocks:
                    list && ts.isArrayLiteralExpression(list.initializer)
                        ? list.initializer.elements.filter(ts.isObjectLiteralExpression).map(element => ({
                              blockId: stringProperty(element, 'blockId') ?? '',
                              column: stringProperty(element, 'column') ?? '',
                              entityType: stringProperty(element, 'entityType'),
                          }))
                        : [],
            };
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return skeleton;
}

/** The value of a top-level `const name = '...'`. */
function constString(source: ts.SourceFile, name: string): string | undefined {
    for (const statement of source.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (
                    declaration.name.getText() === name &&
                    declaration.initializer &&
                    ts.isStringLiteral(declaration.initializer)
                ) {
                    return declaration.initializer.text;
                }
            }
        }
    }
    return undefined;
}

/** The page ids a page passes to `Page`, `OrderDetailShared` and the like. */
function pageIds(source: ts.SourceFile): string[] {
    const ids: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText() === 'pageId' && node.initializer) {
            if (ts.isStringLiteral(node.initializer)) {
                ids.push(node.initializer.text);
            } else if (
                ts.isJsxExpression(node.initializer) &&
                node.initializer.expression &&
                ts.isIdentifier(node.initializer.expression)
            ) {
                const value = constString(source, node.initializer.expression.text);
                if (value) {
                    ids.push(value);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return ids;
}

function jsxAttribute(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
    for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText() === name) {
            const value =
                attribute.initializer && ts.isJsxExpression(attribute.initializer)
                    ? attribute.initializer.expression
                    : attribute.initializer;
            return value && ts.isStringLiteral(value) ? value.text : undefined;
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
        const tag = opening?.tagName.getText() ?? '';
        if (opening && (/^(PageBlock|FullWidthPageBlock)$/.test(tag) || tag in WRAPPER_BLOCKS)) {
            const blockId = WRAPPER_BLOCKS[tag] ?? jsxAttribute(opening, 'blockId');
            if (blockId) {
                let parent = node.parent;
                let conditional = false;
                while (parent && !ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) {
                    if (!ts.isParenthesizedExpression(parent)) {
                        conditional = true;
                    }
                    parent = parent.parent;
                }
                const column = tag === 'FullWidthPageBlock' ? 'full' : jsxAttribute(opening, 'column');
                blocks.push({
                    blockId,
                    column: column ?? '',
                    conditional,
                    entityType: jsxAttribute(opening, 'entityType'),
                });
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
        const skeleton = skeletonOf(source);
        if (!skeleton) {
            return undefined;
        }
        const sources = pageSources(file, source);
        return {
            name: path.relative(ROUTES_DIR, file),
            skeleton,
            pageIds: pageIds(source),
            blocks: sources.flatMap(pageBlocks),
        };
    })
    .filter(route => route !== undefined);

// OSS-1514 — the skeleton of a detail page has the page's own blocks
describe('detail page skeletons', () => {
    it('finds the skeletons of the detail routes', () => {
        expect(routes.length).toBeGreaterThan(25);
    });

    it.each(routes.map(route => [route.name, route] as const))(
        '%s lists blocks the page renders, in their columns and order',
        (_name, { skeleton: { pageId, blocks: skeleton }, pageIds, blocks }) => {
            const columns = ['main', 'side', 'full'];
            expect(pageIds, "the pageId of the skeleton is the page's").toContain(pageId);
            for (const block of skeleton) {
                expect(
                    blocks.some(
                        b =>
                            b.blockId === block.blockId &&
                            b.column === block.column &&
                            b.entityType === block.entityType,
                    ),
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

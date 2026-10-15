import { log } from '@clack/prompts';
import fs from 'fs-extra';
import {
    DocumentNode,
    FieldNode,
    Kind,
    OperationDefinitionNode,
    parse,
    SelectionSetNode,
    visit,
} from 'graphql';
import { Node, SourceFile, SyntaxKind, TemplateLiteral } from 'ts-morph';

import { Messages } from '../core-entities';

type SelectionType = 'Role' | 'RoleList' | 'other';

/** Fields of the Admin API whose selection is a Role, in any parent type. */
const ROLE_FIELDS = new Set(['role', 'createRole', 'updateRole']);
const ROLE_MUTATIONS = new Set(['createRole', 'updateRole']);
const GRAPHQL_TAGS = new Set(['gql', 'graphql']);

export interface GraphqlNote {
    /** Offset of the note in the document text. */
    offset: number;
    message: string;
}

export interface GraphqlStripResult {
    output: string;
    changes: number;
    notes: GraphqlNote[];
}

/**
 * Removes what v4 dropped from the Role type out of a GraphQL document:
 *
 * - `channels` selected on a Role (in `role`, `roles`, `roles { items }`, `createRole`,
 *   `updateRole`, and fragments or inline fragments on `Role`)
 * - `channelIds` in an inline `createRole` / `updateRole` input, plus the variable
 *   definitions that only it used
 *
 * There is no schema to check against, so a Role is recognized by field name and type
 * condition. The text outside the removed ranges is kept as written.
 *
 * `masked` is the same text with template substitutions blanked out, used for parsing;
 * a removal that would touch a substitution is skipped with a note.
 *
 * Returns undefined when the text is not a GraphQL document.
 */
export function stripRoleChannelsFromGraphql(
    source: string,
    masked = source,
): GraphqlStripResult | undefined {
    let document: DocumentNode;
    try {
        document = parse(masked);
    } catch {
        return undefined;
    }

    const removals: Array<[number, number]> = [];
    const notes: GraphqlNote[] = [];
    const removedVariables = new Map<OperationDefinitionNode, Set<string>>();

    const walkSelectionSet = (
        selectionSet: SelectionSetNode,
        type: SelectionType,
        operation: OperationDefinitionNode | undefined,
    ) => {
        const removable =
            type === 'Role'
                ? selectionSet.selections.filter(
                      selection => selection.kind === Kind.FIELD && selection.name.value === 'channels',
                  )
                : [];
        if (removable.length > 0 && removable.length === selectionSet.selections.length) {
            notes.push({
                offset: removable[0].loc?.start ?? 0,
                message:
                    'Role.channels was removed in v4 and is the only field selected here. ' +
                    'Remove the selection by hand.',
            });
        } else {
            for (const selection of removable) {
                removals.push(locationOf(selection));
            }
        }

        for (const selection of selectionSet.selections) {
            if (removable.includes(selection)) {
                continue;
            }
            if (selection.kind === Kind.FIELD) {
                if (ROLE_MUTATIONS.has(selection.name.value)) {
                    stripChannelIdsArgument(selection, operation);
                }
                if (selection.selectionSet) {
                    walkSelectionSet(selection.selectionSet, getChildType(type, selection), operation);
                }
            } else if (selection.kind === Kind.INLINE_FRAGMENT) {
                const childType = selection.typeCondition
                    ? toSelectionType(selection.typeCondition.name.value)
                    : type;
                walkSelectionSet(selection.selectionSet, childType, operation);
            }
        }
    };

    const stripChannelIdsArgument = (field: FieldNode, operation: OperationDefinitionNode | undefined) => {
        for (const argument of field.arguments ?? []) {
            if (argument.value.kind !== Kind.OBJECT) {
                continue;
            }
            for (const objectField of argument.value.fields) {
                if (objectField.name.value !== 'channelIds') {
                    continue;
                }
                removals.push(locationOf(objectField));
                notes.push({ offset: objectField.loc?.start ?? 0, message: Messages.RoleChannelIds });
                if (operation) {
                    const names = removedVariables.get(operation) ?? new Set<string>();
                    visit(objectField.value, {
                        Variable: node => {
                            names.add(node.name.value);
                        },
                    });
                    removedVariables.set(operation, names);
                }
            }
        }
    };

    for (const definition of document.definitions) {
        if (definition.kind === Kind.OPERATION_DEFINITION) {
            walkSelectionSet(definition.selectionSet, 'other', definition);
        } else if (definition.kind === Kind.FRAGMENT_DEFINITION) {
            walkSelectionSet(
                definition.selectionSet,
                toSelectionType(definition.typeCondition.name.value),
                undefined,
            );
        }
    }

    for (const [operation, names] of removedVariables) {
        const stillUsed = new Set<string>();
        visit(operation, {
            VariableDefinition: () => false,
            Variable: node => {
                const start = node.loc?.start ?? 0;
                if (!removals.some(([from, to]) => start >= from && start < to)) {
                    stillUsed.add(node.name.value);
                }
            },
        });
        for (const definition of operation.variableDefinitions ?? []) {
            const name = definition.variable.name.value;
            if (names.has(name) && !stillUsed.has(name)) {
                removals.push(locationOf(definition));
            }
        }
    }

    if (removals.length === 0) {
        return { output: source, changes: 0, notes };
    }

    let output = source;
    let maskedOutput = masked;
    let lastStart = Number.POSITIVE_INFINITY;
    const ranges = removals
        .map(([start, end]) => expandRange(source, start, end))
        .sort((a, b) => b[0] - a[0]);
    for (const [start, end] of ranges) {
        if (end > lastStart) {
            continue;
        }
        if (source.slice(start, end) !== masked.slice(start, end)) {
            notes.push({
                offset: start,
                message:
                    'Role.channels or channelIds sits next to a template substitution here and was not ' +
                    'removed. Remove it by hand.',
            });
            return { output: source, changes: 0, notes };
        }
        output = output.slice(0, start) + output.slice(end);
        maskedOutput = maskedOutput.slice(0, start) + maskedOutput.slice(end);
        lastStart = start;
    }

    try {
        parse(maskedOutput);
    } catch {
        notes.push({
            offset: 0,
            message:
                'Removing Role.channels or channelIds here would leave an invalid document, so it was ' +
                'not changed. Remove them by hand.',
        });
        return { output: source, changes: 0, notes };
    }
    return { output, changes: removals.length, notes };
}

/**
 * Strips Role.channels and channelIds from the GraphQL documents in `gql` / `graphql` tagged
 * templates and `graphql(...)` calls. Returns the number of removals.
 */
export function transformGraphqlTemplates(sourceFile: SourceFile): number {
    const filePath = sourceFile.getFilePath();
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let changes = 0;

    for (const template of findGraphqlTemplates(sourceFile)) {
        // Inside the backticks
        const start = template.getStart() + 1;
        const end = template.getEnd() - 1;
        const source = sourceFile.getFullText().slice(start, end);
        const result = stripRoleChannelsFromGraphql(source, maskSubstitutions(template, start, source));
        if (!result) {
            continue;
        }
        for (const note of result.notes) {
            const line = sourceFile.getLineAndColumnAtPos(start + note.offset).line;
            log.warn(`${filePath}:${line} — ${note.message}`);
        }
        if (result.changes > 0) {
            edits.push({ start, end, text: result.output });
            changes += result.changes;
        }
    }

    // Last first, so earlier positions stay valid
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        sourceFile.replaceText([edit.start, edit.end], edit.text);
    }
    return changes;
}

/**
 * Strips Role.channels and channelIds from a `.graphql` file. Returns the number of removals.
 */
export async function transformGraphqlFile(filePath: string): Promise<number> {
    const source = await fs.readFile(filePath, 'utf-8');
    const result = stripRoleChannelsFromGraphql(source);
    if (!result) {
        log.warn(`${filePath} — could not be parsed as GraphQL, skipped.`);
        return 0;
    }
    for (const note of result.notes) {
        const line = source.slice(0, note.offset).split('\n').length;
        log.warn(`${filePath}:${line} — ${note.message}`);
    }
    if (result.changes > 0) {
        await fs.writeFile(filePath, result.output, 'utf-8');
    }
    return result.changes;
}

function findGraphqlTemplates(sourceFile: SourceFile): TemplateLiteral[] {
    const templates: TemplateLiteral[] = [];
    for (const tagged of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
        if (GRAPHQL_TAGS.has(tagged.getTag().getText())) {
            templates.push(tagged.getTemplate());
        }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const [firstArgument] = call.getArguments();
        if (
            GRAPHQL_TAGS.has(call.getExpression().getText()) &&
            firstArgument &&
            (Node.isNoSubstitutionTemplateLiteral(firstArgument) || Node.isTemplateExpression(firstArgument))
        ) {
            templates.push(firstArgument);
        }
    }
    return templates;
}

/**
 * Replaces each `${...}` in the template text with spaces, keeping line breaks so offsets and
 * line numbers still match.
 */
function maskSubstitutions(template: TemplateLiteral, textStart: number, text: string): string {
    if (!Node.isTemplateExpression(template)) {
        return text;
    }
    const chars = [...text];
    let previousLiteralEnd = template.getHead().getEnd();
    for (const span of template.getTemplateSpans()) {
        const literal = span.getLiteral();
        // From the `${` that ends the previous literal to the `}` that starts this one
        const from = previousLiteralEnd - 2 - textStart;
        const to = literal.getStart() + 1 - textStart;
        for (let i = from; i < to; i++) {
            if (chars[i] !== '\n') {
                chars[i] = ' ';
            }
        }
        previousLiteralEnd = literal.getEnd();
    }
    return chars.join('');
}

function getChildType(parentType: SelectionType, field: FieldNode): SelectionType {
    const name = field.name.value;
    if (parentType === 'RoleList' && name === 'items') {
        return 'Role';
    }
    if (ROLE_FIELDS.has(name)) {
        return 'Role';
    }
    if (name === 'roles') {
        // The `roles` query returns a RoleList; `User.roles` returns Roles
        const selectsItems = field.selectionSet?.selections.some(
            selection => selection.kind === Kind.FIELD && selection.name.value === 'items',
        );
        return selectsItems ? 'RoleList' : 'Role';
    }
    return 'other';
}

function toSelectionType(typeName: string): SelectionType {
    return typeName === 'Role' || typeName === 'RoleList' ? typeName : 'other';
}

function locationOf(node: { loc?: { start: number; end: number } }): [number, number] {
    if (!node.loc) {
        throw new Error('GraphQL node has no location');
    }
    return [node.loc.start, node.loc.end];
}

/**
 * Widens a removal to the whole line when the node is alone on it, otherwise to the whitespace
 * before it and one separating comma, after it or else before it.
 */
function expandRange(text: string, start: number, end: number): [number, number] {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const newline = text.indexOf('\n', end);
    const lineEnd = newline === -1 ? text.length : newline;
    if (/^[ \t]*$/.test(text.slice(lineStart, start)) && /^[ \t,]*$/.test(text.slice(end, lineEnd))) {
        return [lineStart, Math.min(lineEnd + 1, text.length)];
    }
    let from = start;
    while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) {
        from--;
    }
    if (text[end] === ',') {
        return [from, end + 1];
    }
    return [text[from - 1] === ',' ? from - 1 : from, end];
}

import { Variables } from '@/vdb/graphql/api.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
    DefinitionNode,
    DocumentNode,
    FieldNode,
    FragmentDefinitionNode,
    Kind,
    OperationDefinitionNode,
    parse,
    SelectionNode,
    SelectionSetNode,
} from 'graphql';

/**
 * Type-safe template string function for extending GraphQL documents
 */
export function extendDocument<T extends TypedDocumentNode, V extends Variables = Variables>(
    defaultDocument: T,
    template: TemplateStringsArray,
    ...values: any[]
): T;
export function extendDocument<T extends TypedDocumentNode, V extends Variables = Variables>(
    defaultDocument: T,
    sdl: string | DocumentNode,
): T;
export function extendDocument<T extends TypedDocumentNode, V extends Variables = Variables>(
    defaultDocument: T,
    template: TemplateStringsArray | string | DocumentNode,
    ...values: any[]
): T {
    // Handle template strings, regular strings, and DocumentNode
    let extensionDocument: DocumentNode;
    if (Array.isArray(template)) {
        // Template string array
        const sdl = (template as TemplateStringsArray).reduce((result, str, i) => {
            return result + str + String(values[i] ?? '');
        }, '');
        extensionDocument = parse(sdl);
    } else if (typeof template === 'string') {
        // Regular string
        extensionDocument = parse(template);
    } else {
        // DocumentNode
        extensionDocument = template as DocumentNode;
    }

    // Merge the documents
    const mergedDocument = mergeDocuments(defaultDocument, extensionDocument);

    return mergedDocument as T;
}

/**
 * Merges two GraphQL documents, adding fields from the extension to the base document
 */
function mergeDocuments(baseDocument: DocumentNode, extensionDocument: DocumentNode): DocumentNode {
    const baseClone = JSON.parse(JSON.stringify(baseDocument)) as DocumentNode;

    // Get all operation definitions from both documents
    const baseOperations = baseClone.definitions.filter(isOperationDefinition);
    const extensionOperations = extensionDocument.definitions.filter(isOperationDefinition);

    // Get all fragment definitions from both documents
    const baseFragments = baseClone.definitions.filter(isFragmentDefinition);
    const extensionFragments = extensionDocument.definitions.filter(isFragmentDefinition);

    // Merge fragments first (extensions can reference them)
    const mergedFragments = [...baseFragments, ...extensionFragments];

    // For each operation in the extension, find the corresponding base operation and merge
    for (const extensionOp of extensionOperations) {
        // Get the top-level field name from the extension operation
        const extensionField = extensionOp.selectionSet.selections[0] as FieldNode;
        if (!extensionField) {
            throw new Error('Extension query must have at least one top-level field');
        }

        // Find a base operation that has the same top-level field
        const baseOp = baseOperations.find(op => {
            const baseField = op.selectionSet.selections[0] as FieldNode;
            return baseField && baseField.name.value === extensionField.name.value;
        });

        if (!baseOp) {
            const validQueryFields = baseOperations
                .map(op => {
                    const field = op.selectionSet.selections[0] as FieldNode;
                    return field ? field.name.value : 'unknown';
                })
                .join(', ');
            throw new Error(
                `The query extension must extend the '${validQueryFields}' query. ` +
                    `Got '${extensionField.name.value}' instead.`,
            );
        }

        // Merge the selection sets of the matching top-level fields
        const baseFieldNode = baseOp.selectionSet.selections[0] as FieldNode;
        if (baseFieldNode.selectionSet && extensionField.selectionSet) {
            mergeSelectionSets(baseFieldNode.selectionSet, extensionField.selectionSet);
        }
    }

    // Update the document with merged definitions
    (baseClone as any).definitions = [...baseOperations, ...mergedFragments];

    return baseClone;
}

/**
 * Merges two selection sets, adding fields from the extension to the base
 */
function mergeSelectionSets(
    baseSelectionSet: SelectionSetNode,
    extensionSelectionSet: SelectionSetNode,
): void {
    const baseFields = baseSelectionSet.selections.filter(isFieldNode);
    const extensionFields = extensionSelectionSet.selections.filter(isFieldNode);

    for (const extensionField of extensionFields) {
        const existingField = baseFields.find(field => field.name.value === extensionField.name.value);

        if (existingField) {
            // Field already exists, merge their selection sets if both have them
            if (existingField.selectionSet && extensionField.selectionSet) {
                mergeSelectionSets(existingField.selectionSet, extensionField.selectionSet);
            } else if (extensionField.selectionSet && !existingField.selectionSet) {
                // Extension has a selection set but base doesn't, add it
                (existingField as any).selectionSet = extensionField.selectionSet;
            }
        } else {
            // Field doesn't exist, add it
            (baseSelectionSet as any).selections.push(extensionField);
        }
    }
}

/**
 * Type guards
 */
function isOperationDefinition(value: DefinitionNode): value is OperationDefinitionNode {
    return value.kind === Kind.OPERATION_DEFINITION;
}

function isFragmentDefinition(value: DefinitionNode): value is FragmentDefinitionNode {
    return value.kind === Kind.FRAGMENT_DEFINITION;
}

function isFieldNode(value: SelectionNode): value is FieldNode {
    return value.kind === Kind.FIELD;
}

/**
 * Utility function to create a template string tag for better DX
 */
export function gqlExtend(strings: TemplateStringsArray, ...values: any[]) {
    return (defaultDocument: DocumentNode) => extendDocument(defaultDocument, strings, ...values);
}

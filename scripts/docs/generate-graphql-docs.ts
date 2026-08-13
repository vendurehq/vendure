import fs from 'fs';
import {
    buildClientSchema,
    GraphQLEnumType,
    GraphQLField,
    GraphQLInputObjectType,
    GraphQLNamedType,
    GraphQLObjectType,
    GraphQLScalarType,
    GraphQLType,
    GraphQLUnionType,
    isEnumType,
    isInputObjectType,
    isListType,
    isNamedType,
    isNonNullType,
    isObjectType,
    isScalarType,
    isUnionType,
} from 'graphql';
import path from 'path';

import { deleteGeneratedDocs, generateFrontMatter } from '@vendure-io/docs-generator';

/* eslint-disable no-console */

type TargetApi = 'shop' | 'admin';

const targetApi: TargetApi = getTargetApiFromArgs();

// The path to the introspection schema json file
const SCHEMA_FILE = path.join(__dirname, `../../schema-${targetApi}.json`);
// The absolute URL to the generated api docs section
const docsUrl = `/reference/graphql-api/${targetApi}/`;
// The directory in which the markdown files will be saved
const outputPath = path.join(__dirname, `../../docs/docs/reference/graphql-api/${targetApi}`);

const enum FileName {
    ENUM = 'enums',
    INPUT = 'input-types',
    MUTATION = 'mutations',
    QUERY = 'queries',
    OBJECT = 'object-types',
}

type GraphQLDocType = 'query' | 'mutation' | 'type' | 'input' | 'enum' | 'scalar' | 'union';

const schemaJson = fs.readFileSync(SCHEMA_FILE, 'utf8');
const parsed = JSON.parse(schemaJson);
const schema = buildClientSchema(parsed.data ? parsed.data : parsed);

// ============================================================================
// Type Reference Collection Helpers
// ============================================================================

/**
 * Collects all referenced type names from a GraphQL type (unwrapping NonNull/List wrappers)
 */
function collectReferencedTypes(type: GraphQLType): Set<string> {
    const types = new Set<string>();
    let current = type;
    while (!isNamedType(current)) {
        if (isNonNullType(current) || isListType(current)) {
            current = current.ofType;
        }
    }
    if (isNamedType(current)) {
        types.add(current.name);
    }
    return types;
}

/**
 * Collects all referenced types from a field (including arguments and return type)
 */
function collectFieldReferencedTypes(field: GraphQLField<any, any>): Set<string> {
    const types = new Set<string>();
    // Return type
    for (const t of collectReferencedTypes(field.type)) {
        types.add(t);
    }
    // Argument types
    if (field.args) {
        for (const arg of field.args) {
            for (const t of collectReferencedTypes(arg.type)) {
                types.add(t);
            }
        }
    }
    return types;
}

/**
 * Collects all referenced types from an object or input type's fields
 */
function collectTypeReferencedTypes(type: GraphQLObjectType | GraphQLInputObjectType): Set<string> {
    const types = new Set<string>();
    for (const field of Object.values(type.getFields())) {
        for (const t of collectFieldReferencedTypes(field as GraphQLField<any, any>)) {
            types.add(t);
        }
    }
    return types;
}

/**
 * Collects all types from a union
 */
function collectUnionReferencedTypes(type: GraphQLUnionType): Set<string> {
    const types = new Set<string>();
    for (const t of type.getTypes()) {
        types.add(t.name);
    }
    return types;
}

/**
 * Builds a map of type names to their documentation URLs
 */
function buildTypeLinksMap(referencedTypes: Set<string>): Record<string, string> {
    const typeLinks: Record<string, string> = {};
    for (const typeName of referencedTypes) {
        const schemaType = schema.getType(typeName);
        if (!schemaType) continue;

        let fileName: FileName;
        if (isEnumType(schemaType)) {
            fileName = FileName.ENUM;
        } else if (isInputObjectType(schemaType)) {
            fileName = FileName.INPUT;
        } else {
            fileName = FileName.OBJECT;
        }
        typeLinks[typeName] = `${docsUrl}${fileName}#${typeName.toLowerCase()}`;
    }
    return typeLinks;
}

// ============================================================================
// SDL Rendering Helpers (plain GraphQL text, no HTML)
// ============================================================================

/**
 * Escapes non-ASCII Unicode characters to \uXXXX format
 */
function escapeUnicodeCharacters(str: string): string {
    return str.replace(/[^\x00-\x7F]/g, char => {
        const codePoint = char.codePointAt(0);
        if (codePoint !== undefined && codePoint <= 0xFFFF) {
            return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
        }
        // For characters outside BMP, use surrogate pairs
        if (codePoint !== undefined) {
            const highSurrogate = Math.floor((codePoint - 0x10000) / 0x400) + 0xD800;
            const lowSurrogate = ((codePoint - 0x10000) % 0x400) + 0xDC00;
            return `\\u${highSurrogate.toString(16).toUpperCase()}\\u${lowSurrogate.toString(16).toUpperCase()}`;
        }
        return char;
    });
}

/**
 * Escapes template string special characters (backslashes, backticks and ${) and non-ASCII Unicode
 */
function escapeTemplateString(str: string): string {
    // Escape backslashes first, then backticks and ${
    return escapeUnicodeCharacters(
        str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'),
    );
}

/**
 * Strips JSDoc-style tags from descriptions
 */
function stripJSDocTags(description: string): string {
    const stringsToStrip = [/@docsCategory\s+[^\n]+/g, /@description\s+/g];
    let result = description;
    for (const pattern of stringsToStrip) {
        result = result.replace(pattern, '');
    }
    // Replace {@link SomeName} with just SomeName to avoid MDX JSX expression issues
    // Use non-greedy +? to prevent ReDoS via backtracking
    result = result.replace(/\{@link\s+([^}]+?)\}/g, '$1');
    return result.trim();
}

/**
 * Renders a description as SDL triple-quote format
 */
function renderSDLDescription(description: string | null | undefined, indent = ''): string {
    if (!description || description.trim() === '') {
        return '';
    }
    const cleanDescription = stripJSDocTags(description);
    if (cleanDescription === '') {
        return '';
    }
    const lines = cleanDescription.split('\n');
    if (lines.length === 1) {
        return `${indent}"""${cleanDescription}"""\n`;
    }
    return `${indent}"""\n${lines.map(line => `${indent}${line}`).join('\n')}\n${indent}"""\n`;
}

/**
 * Renders a GraphQL type as a string (e.g., [String!]!)
 */
function renderTypeString(type: GraphQLType): string {
    return type.toString();
}

/**
 * Renders a single field as SDL
 */
function renderFieldSDL(
    field: GraphQLField<any, any>,
    indent = '  ',
    includeDescription = true,
): string {
    let result = '';
    if (includeDescription && field.description) {
        result += renderSDLDescription(field.description, indent);
    }
    let fieldLine = `${indent}${field.name}`;
    if (field.args && field.args.length > 0) {
        const args = field.args.map(arg => `${arg.name}: ${renderTypeString(arg.type)}`).join(', ');
        fieldLine += `(${args})`;
    }
    fieldLine += `: ${renderTypeString(field.type)}`;
    result += fieldLine + '\n';
    return result;
}

/**
 * Renders an object type as SDL
 */
function renderObjectTypeSDL(type: GraphQLObjectType): string {
    let result = '';
    if (type.description) {
        result += renderSDLDescription(type.description);
    }
    result += `type ${type.name} {\n`;
    for (const field of Object.values(type.getFields())) {
        result += renderFieldSDL(field);
    }
    result += '}';
    return result;
}

/**
 * Renders an input type as SDL
 */
function renderInputTypeSDL(type: GraphQLInputObjectType): string {
    let result = '';
    if (type.description) {
        result += renderSDLDescription(type.description);
    }
    result += `input ${type.name} {\n`;
    for (const field of Object.values(type.getFields())) {
        let fieldResult = '';
        if (field.description) {
            fieldResult += renderSDLDescription(field.description, '  ');
        }
        fieldResult += `  ${field.name}: ${renderTypeString(field.type)}\n`;
        result += fieldResult;
    }
    result += '}';
    return result;
}

/**
 * Renders an enum type as SDL
 */
function renderEnumTypeSDL(type: GraphQLEnumType): string {
    let result = '';
    if (type.description) {
        result += renderSDLDescription(type.description);
    }
    result += `enum ${type.name} {\n`;
    for (const value of type.getValues()) {
        if (value.description) {
            result += renderSDLDescription(value.description, '  ');
        }
        result += `  ${value.name}\n`;
    }
    result += '}';
    return result;
}

/**
 * Renders a scalar type as SDL
 */
function renderScalarSDL(type: GraphQLScalarType): string {
    let result = '';
    if (type.description) {
        result += renderSDLDescription(type.description);
    }
    result += `scalar ${type.name}`;
    return result;
}

/**
 * Renders a union type as SDL
 */
function renderUnionSDL(type: GraphQLUnionType): string {
    let result = '';
    if (type.description) {
        result += renderSDLDescription(type.description);
    }
    const members = type.getTypes().map(t => t.name).join(' | ');
    result += `union ${type.name} = ${members}`;
    return result;
}

/**
 * Renders a query/mutation field wrapped in its parent type as SDL
 * Note: Description is included at the top level, not inside the field
 */
function renderQueryMutationFieldSDL(field: GraphQLField<any, any>, parentTypeName: 'Query' | 'Mutation'): string {
    let result = '';
    if (field.description) {
        result += renderSDLDescription(field.description);
    }
    result += `type ${parentTypeName} {\n`;
    // Skip description inside the field since it's already at the top level
    result += renderFieldSDL(field, '  ', false);
    result += '}';
    return result;
}

// ============================================================================
// GraphQLDoc Component Generator
// ============================================================================

/**
 * Renders a GraphQLDoc component for MDX
 */
function renderGraphQLDocComponent(options: {
    type: GraphQLDocType;
    typeName: string;
    sdlContent: string;
    typeLinks: Record<string, string>;
    deprecated?: boolean | string;
}): string {
    const { type, typeName, sdlContent, typeLinks, deprecated } = options;
    const escapedSdl = escapeTemplateString(sdlContent);

    // Build typeLinks prop
    const typeLinksEntries = Object.entries(typeLinks);
    let typeLinksStr = '{}';
    if (typeLinksEntries.length > 0) {
        const entries = typeLinksEntries
            .map(([name, url]) => `    ${name}: '${url}'`)
            .join(',\n');
        typeLinksStr = `{\n${entries},\n  }`;
    }

    let result = `<GraphQLDoc\n`;
    result += `  type="${type}"\n`;
    result += `  typeName="${typeName}"\n`;
    result += `  typeLinks={${typeLinksStr}}\n`;
    if (deprecated) {
        if (typeof deprecated === 'string') {
            result += `  deprecated="${escapeTemplateString(deprecated)}"\n`;
        } else {
            result += `  deprecated={true}\n`;
        }
    }
    result += `>\n`;
    result += `{\`${escapedSdl}\`}\n`;
    result += `</GraphQLDoc>`;
    return result;
}

deleteGeneratedDocs(outputPath);
generateGraphqlDocs(outputPath);

function generateGraphqlDocs(outputDir: string) {
    const timeStart = +new Date();
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let queriesOutput = generateFrontMatter('Queries') + '\n\n';
    let mutationsOutput = generateFrontMatter('Mutations') + '\n\n';
    let objectTypesOutput = generateFrontMatter('Types') + '\n\n';
    let inputTypesOutput = generateFrontMatter('Input Objects') + '\n\n';
    let enumsOutput = generateFrontMatter('Enums') + '\n\n';

    const sortByName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);
    const sortedTypes = Object.values(schema.getTypeMap()).sort(sortByName);

    for (const type of sortedTypes) {
        if (type.name.substring(0, 2) === '__') {
            // ignore internal types
            continue;
        }

        if (isObjectType(type)) {
            if (type.name === 'Query') {
                // Handle Query fields
                for (const field of Object.values(type.getFields()).sort(sortByName)) {
                    if (field.name === 'temp__') {
                        continue;
                    }
                    const referencedTypes = collectFieldReferencedTypes(field);
                    const typeLinks = buildTypeLinksMap(referencedTypes);
                    const sdlContent = renderQueryMutationFieldSDL(field, 'Query');
                    const deprecated = field.deprecationReason || undefined;

                    queriesOutput += `\n<a name="${field.name.toLowerCase()}"></a>\n\n## ${field.name}\n\n`;
                    queriesOutput += renderGraphQLDocComponent({
                        type: 'query',
                        typeName: field.name,
                        sdlContent,
                        typeLinks,
                        deprecated,
                    });
                    queriesOutput += '\n';
                }
            } else if (type.name === 'Mutation') {
                // Handle Mutation fields
                for (const field of Object.values(type.getFields()).sort(sortByName)) {
                    const referencedTypes = collectFieldReferencedTypes(field);
                    const typeLinks = buildTypeLinksMap(referencedTypes);
                    const sdlContent = renderQueryMutationFieldSDL(field, 'Mutation');
                    const deprecated = field.deprecationReason || undefined;

                    mutationsOutput += `\n<a name="${field.name.toLowerCase()}"></a>\n\n## ${field.name}\n\n`;
                    mutationsOutput += renderGraphQLDocComponent({
                        type: 'mutation',
                        typeName: field.name,
                        sdlContent,
                        typeLinks,
                        deprecated,
                    });
                    mutationsOutput += '\n';
                }
            } else {
                // Handle regular object types
                const referencedTypes = collectTypeReferencedTypes(type);
                const typeLinks = buildTypeLinksMap(referencedTypes);
                const sdlContent = renderObjectTypeSDL(type);

                objectTypesOutput += `\n<a name="${type.name.toLowerCase()}"></a>\n\n## ${type.name}\n\n`;
                objectTypesOutput += renderGraphQLDocComponent({
                    type: 'type',
                    typeName: type.name,
                    sdlContent,
                    typeLinks,
                });
                objectTypesOutput += '\n';
            }
        }

        if (isEnumType(type)) {
            const sdlContent = renderEnumTypeSDL(type);

            enumsOutput += `\n<a name="${type.name.toLowerCase()}"></a>\n\n## ${type.name}\n\n`;
            enumsOutput += renderGraphQLDocComponent({
                type: 'enum',
                typeName: type.name,
                sdlContent,
                typeLinks: {},
            });
            enumsOutput += '\n';
        }

        if (isScalarType(type)) {
            const sdlContent = renderScalarSDL(type);

            objectTypesOutput += `\n<a name="${type.name.toLowerCase()}"></a>\n\n## ${type.name}\n\n`;
            objectTypesOutput += renderGraphQLDocComponent({
                type: 'scalar',
                typeName: type.name,
                sdlContent,
                typeLinks: {},
            });
            objectTypesOutput += '\n';
        }

        if (isInputObjectType(type)) {
            const referencedTypes = collectTypeReferencedTypes(type);
            const typeLinks = buildTypeLinksMap(referencedTypes);
            const sdlContent = renderInputTypeSDL(type);

            inputTypesOutput += `\n<a name="${type.name.toLowerCase()}"></a>\n\n## ${type.name}\n\n`;
            inputTypesOutput += renderGraphQLDocComponent({
                type: 'input',
                typeName: type.name,
                sdlContent,
                typeLinks,
            });
            inputTypesOutput += '\n';
        }

        if (isUnionType(type)) {
            const referencedTypes = collectUnionReferencedTypes(type);
            const typeLinks = buildTypeLinksMap(referencedTypes);
            const sdlContent = renderUnionSDL(type);

            objectTypesOutput += `\n<a name="${type.name.toLowerCase()}"></a>\n\n## ${type.name}\n\n`;
            objectTypesOutput += renderGraphQLDocComponent({
                type: 'union',
                typeName: type.name,
                sdlContent,
                typeLinks,
            });
            objectTypesOutput += '\n';
        }
    }

    fs.writeFileSync(path.join(outputDir, FileName.QUERY + '.mdx'), queriesOutput);
    fs.writeFileSync(path.join(outputDir, FileName.MUTATION + '.mdx'), mutationsOutput);
    fs.writeFileSync(path.join(outputDir, FileName.OBJECT + '.mdx'), objectTypesOutput);
    fs.writeFileSync(path.join(outputDir, FileName.INPUT + '.mdx'), inputTypesOutput);
    fs.writeFileSync(path.join(outputDir, FileName.ENUM + '.mdx'), enumsOutput);

    // Generate _index.mdx for the API section
    const apiTitle = targetApi === 'admin' ? 'Admin API' : 'Shop API';
    const indexOutput = generateFrontMatter(apiTitle) + '\n\n' +
        `<LinkCard href="${docsUrl}${FileName.QUERY}" title="Queries" />\n` +
        `<LinkCard href="${docsUrl}${FileName.MUTATION}" title="Mutations" />\n` +
        `<LinkCard href="${docsUrl}${FileName.OBJECT}" title="Types" />\n` +
        `<LinkCard href="${docsUrl}${FileName.INPUT}" title="Input Objects" />\n` +
        `<LinkCard href="${docsUrl}${FileName.ENUM}" title="Enums" />\n`;
    fs.writeFileSync(path.join(outputDir, '_index.mdx'), indexOutput);

    console.log(`Generated 5 GraphQL API docs in ${+new Date() - timeStart}ms`);
}

function getTargetApiFromArgs(): TargetApi {
    const apiArg = process.argv.find(arg => /--api=(shop|admin)/.test(arg));
    if (!apiArg) {
        console.error('\nPlease specify which GraphQL API to generate docs for: --api=<shop|admin>\n');
        process.exit(1);
        return null as never;
    }
    return apiArg === '--api=shop' ? 'shop' : 'admin';
}

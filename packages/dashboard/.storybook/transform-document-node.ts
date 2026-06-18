import { print } from 'graphql';

/**
 * Transforms Storybook source code to replace inline DocumentNode objects
 * with their GraphQL SDL string representation.
 *
 * @param source - The source code string from Storybook containing inline DocumentNode objects
 * @param storyContext - The Storybook context containing args with DocumentNode instances
 * @returns Transformed source code with DocumentNodes displayed as SDL strings
 *
 * @example
 * // Input source:
 * // queryDocument={{ kind: 'Document', definitions: [...] }}
 * //
 * // Output:
 * // queryDocument={graphql`
 * //     query Product($id: ID!) {
 * //         product(id: $id) { ... }
 * //     }
 * // `}
 */
export function transformDocumentNodeInSource(source: string, storyContext: any): string {
    let transformedSource = source;

    try {
        // Get the actual DocumentNode instances from story args
        const args = storyContext?.args;
        if (!args) return source;

        // Find all prop assignments that could be DocumentNodes
        // Pattern: propName={{ ... }}
        const propPattern = /(\w+)=\{\{/g;
        let match;
        const replacements: Array<{ start: number; end: number; propName: string }> = [];

        while ((match = propPattern.exec(source)) !== null) {
            const propName = match[1];
            const startPos = match.index;
            const openBracePos = match.index + match[0].length - 2; // Position of first {{

            // Find the matching closing }}
            let braceCount = 2; // We start with {{
            let pos = openBracePos + 2;
            let foundEnd = false;

            while (pos < source.length && braceCount > 0) {
                if (source[pos] === '{') {
                    braceCount++;
                } else if (source[pos] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        foundEnd = true;
                        break;
                    }
                }
                pos++;
            }

            if (foundEnd) {
                replacements.push({
                    start: startPos,
                    end: pos + 1, // Include the final }
                    propName,
                });
            }
        }

        // Process replacements in reverse order to maintain indices
        for (let i = replacements.length - 1; i >= 0; i--) {
            const { start, end, propName } = replacements[i];

            try {
                // Get the corresponding DocumentNode from args
                const docNode = args[propName];

                // Verify it's a valid GraphQL DocumentNode
                if (!isDocumentNode(docNode)) {
                    continue;
                }

                // Convert DocumentNode AST to SDL string
                const sdl = print(docNode);

                // Format with proper indentation for readability
                const formattedSdl = formatSdlForDisplay(sdl);

                const replacement = `${propName}={graphql\`\n${formattedSdl}\n  \`}`;

                // Replace the inline object with the formatted SDL
                transformedSource =
                    transformedSource.substring(0, start) + replacement + transformedSource.substring(end);
            } catch (e) {
                console.error(`Failed to transform DocumentNode for prop "${propName}":`, e);
            }
        }

        // Also handle variable references like: queryDocument={productQuery}
        const varRefPattern = /(\w+)=\{(\w+(?:Query|Document|Mutation|Fragment))\}/g;
        transformedSource = transformedSource.replace(
            varRefPattern,
            (match: string, propName: string, varName: string) => {
                try {
                    // Get the corresponding DocumentNode from args using the prop name
                    const docNode = args[propName];

                    // Verify it's a valid GraphQL DocumentNode
                    if (!isDocumentNode(docNode)) {
                        return match;
                    }

                    // Convert DocumentNode AST to SDL string
                    const sdl = print(docNode);

                    // Format with proper indentation for readability
                    const formattedSdl = formatSdlForDisplay(sdl);

                    return `${propName}={graphql\`\n${formattedSdl}\n  \`}`;
                } catch (e) {
                    console.error(`Failed to transform DocumentNode variable for prop "${propName}":`, e);
                    return match;
                }
            },
        );
    } catch (e) {
        console.error('Failed to transform DocumentNode source:', e);
        return source;
    }

    return transformedSource;
}

/**
 * Checks if an object is a valid GraphQL DocumentNode
 */
function isDocumentNode(obj: any): boolean {
    return (
        obj &&
        typeof obj === 'object' &&
        obj.kind === 'Document' &&
        Array.isArray(obj.definitions) &&
        obj.definitions.length > 0
    );
}

/**
 * Formats SDL string with proper indentation for display in Storybook docs
 */
function formatSdlForDisplay(sdl: string): string {
    const lines = sdl.split('\n');
    return lines
        .map(line => {
            // All lines get consistent 4-space indentation
            return '    ' + line;
        })
        .join('\n');
}

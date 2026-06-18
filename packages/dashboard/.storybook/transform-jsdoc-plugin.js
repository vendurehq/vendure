/**
 * Vite plugin that cleans up JSDoc comments in component source files for Storybook.
 *
 * **Why this exists:**
 * - Our codebase uses custom JSDoc tags (@description, @docsCategory, @docsPage) for documentation generation
 * - These custom tags clutter Storybook's auto-generated prop tables and component descriptions
 * - This plugin removes the tag labels while preserving the actual content
 * - TypeScript's react-docgen-typescript can then properly extract clean descriptions
 *
 * **What it does:**
 * - Removes the `@description` tag line (content is preserved as the first JSDoc paragraph)
 * - Removes `@docsCategory` and `@docsPage` tags entirely
 * - Keeps `@example` tags (these are extracted by extractJSDocPlugin)
 * - Only processes component source files (not node_modules or story files)
 *
 * **Example transformation:**
 * ```
 * Before:
 * /**
 *  * @description
 *  * A component for displaying an input with a prefix.
 *  * @docsCategory form-components
 *  *\/
 *
 * After:
 * /**
 *  * A component for displaying an input with a prefix.
 *  *\/
 * ```
 *
 * @returns {import('vite').Plugin}
 */
export function transformJSDocPlugin() {
    return {
        name: 'transform-jsdoc',
        enforce: 'pre', // Run before other plugins
        transform(code, id) {
            // Only process source TypeScript/TSX files (not node_modules, not stories)
            if (!id.endsWith('.tsx') && !id.endsWith('.ts')) {
                return null;
            }

            if (id.includes('node_modules') || id.includes('.stories.')) {
                return null;
            }

            // Only process files with @description tag
            if (!code.includes('@description')) {
                return null;
            }

            // Transform JSDoc comments: remove @description/@docsCategory/@docsPage tags
            const transformed = code.replace(
                /\/\*\*([\s\S]*?)\*\//g,
                (match, content) => {
                    // Only transform JSDoc blocks that have @description
                    if (!content.includes('@description')) {
                        return match;
                    }

                    const lines = content.split('\n');
                    const transformedLines = [];
                    let skipNextEmptyLine = false;

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];

                        // Remove @description line entirely
                        if (line.match(/\s*\*\s*@description\s*$/)) {
                            skipNextEmptyLine = true;
                            continue;
                        }

                        // Remove @docsCategory and @docsPage lines
                        if (line.match(/\s*\*\s*@(docsCategory|docsPage)\s+[\w-]+/)) {
                            continue;
                        }

                        // Skip empty line after @description
                        if (skipNextEmptyLine && line.match(/^\s*\*\s*$/)) {
                            skipNextEmptyLine = false;
                            continue;
                        }

                        transformedLines.push(line);
                    }

                    return `/**${transformedLines.join('\n')}*/`;
                },
            );

            return {
                code: transformed,
                map: null,
            };
        },
    };
}

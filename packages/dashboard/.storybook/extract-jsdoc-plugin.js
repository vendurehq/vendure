import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';

/**
 * Vite plugin that extracts JSDoc documentation from component files and inlines it into Storybook stories.
 *
 * **Why this exists:**
 * - Our codebase uses custom JSDoc tags (@description, @docsCategory, @docsPage) for documentation generation
 * - TypeScript's JSDoc parser treats @description as a tag, not as description content
 * - Storybook's react-docgen-typescript reads source files directly, bypassing Vite transformations
 * - This plugin runs at build time to extract descriptions from component JSDoc and inline them into story metadata
 * - This avoids duplicating documentation between source files and Storybook stories
 *
 * **How it works:**
 * 1. Finds `withDescription(import.meta.url, './component.js')` calls in story files
 * 2. Reads the component source file from disk at build time
 * 3. Extracts description and @example blocks from JSDoc comments
 * 4. Inlines the extracted content into the story's `parameters.docs.description.component`
 * 5. Removes the `withDescription` import since it's no longer needed
 *
 * **Usage in story files:**
 * ```typescript
 * import { withDescription } from '../../../../.storybook/with-description.js';
 *
 * const meta = {
 *   title: 'Form Inputs/AffixedInput',
 *   component: AffixedInput,
 *   ...withDescription(import.meta.url, './affixed-input.js'),
 * } satisfies Meta<typeof AffixedInput>;
 * ```
 */
export function extractJSDocPlugin() {
    return {
        name: 'extract-jsdoc-description',
        transform(code, id) {
            // Only process .stories.tsx files
            if (!id.endsWith('.stories.tsx')) {
                return null;
            }

            // Look for withDescription calls
            const withDescRegex = /withDescription\(import\.meta\.url,\s*['"]([^'"]+)['"]\)/g;
            let match;
            let transformed = code;
            let hasWithDescription = false;

            while ((match = withDescRegex.exec(code)) !== null) {
                hasWithDescription = true;
                const componentPath = match[1];
                const fullMatch = match[0];

                try {
                    // Resolve component path relative to story file
                    const storyDir = dirname(id);
                    const componentFilePath = resolve(storyDir, componentPath.replace('.js', '.tsx'));

                    // Read component source
                    const source = readFileSync(componentFilePath, 'utf-8');

                    // Extract description and examples from JSDoc
                    const description = extractDescription(source, componentPath);

                    if (description) {
                        // Remove the spread and the withDescription call
                        const removePattern = new RegExp(
                            `\\.\\.\\.${fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`,
                            'g',
                        );
                        transformed = transformed.replace(removePattern, '');

                        // Add the description to parameters.docs.description.component
                        const hasParameters = /parameters:\s*\{/.test(transformed);

                        if (hasParameters) {
                            // Add docs.description.component to existing parameters
                            transformed = transformed.replace(
                                /(parameters:\s*\{)/,
                                `$1\n        docs: { description: { component: ${JSON.stringify(description)} } },`,
                            );
                        } else {
                            // Add new parameters object
                            transformed = transformed.replace(
                                /(}\s*satisfies\s+Meta)/,
                                `,\n    parameters: {\n        docs: { description: { component: ${JSON.stringify(description)} } }\n    }$1`,
                            );
                        }
                    } else {
                        // Even if we couldn't extract description, still remove the withDescription call
                        const removePattern = new RegExp(
                            `\\.\\.\\.${fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`,
                            'g',
                        );
                        transformed = transformed.replace(removePattern, '');
                    }
                } catch (error) {
                    console.error(`Failed to extract description for ${componentPath}:`, error);
                    // Even on error, remove the withDescription call to avoid import errors
                    const removePattern = new RegExp(
                        `\\.\\.\\.${fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`,
                        'g',
                    );
                    transformed = transformed.replace(removePattern, '');
                }
            }

            // Always remove the withDescription import if we found any withDescription calls
            if (hasWithDescription) {
                transformed = transformed.replace(
                    /import\s+\{\s*withDescription\s*\}\s+from\s+['"][^'"]+with-description\.js['"];?\s*\n?/,
                    '',
                );

                return {
                    code: transformed,
                    map: null,
                };
            }

            return null;
        },
    };
}

function extractDescription(source, componentPath) {
    // Get the base filename without path and extension
    // e.g., './datetime-input.js' -> 'datetime-input'
    const fileName = componentPath.replace(/^\.\//, '').replace(/\.js$/, '');

    // Convert kebab-case filename to PascalCase component name
    // e.g., 'datetime-input' -> 'DateTimeInput', 'asset-gallery' -> 'AssetGallery'
    const expectedComponentName = fileName
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');

    // Strategy: Find the component export first, then look backward for its JSDoc
    // This ensures we get the comment IMMEDIATELY before the export, not an earlier one

    // Step 1: Find the position of the component export
    const exportPattern = new RegExp(`export\\s+(?:function|const)\\s+${expectedComponentName}\\b`, 'g');

    const exportMatch = exportPattern.exec(source);

    if (!exportMatch) {
        return null;
    }

    // Step 2: Look backward from the export to find the JSDoc comment immediately before it
    // We only want the comment that has ONLY whitespace between it and the export
    const beforeExport = source.substring(0, exportMatch.index);

    // Find the position of the LAST /** in the text before the export
    const lastJsDocStart = beforeExport.lastIndexOf('/**');

    if (lastJsDocStart === -1) {
        return null;
    }

    // Extract from the last /** to the end of beforeExport
    const jsdocText = beforeExport.substring(lastJsDocStart);

    // Now match /**...*/ followed by only whitespace
    const jsdocPattern = /^\/\*\*([\s\S]*?)\*\/\s*$/;
    const match = jsdocPattern.exec(jsdocText);

    if (!match) {
        return null;
    }

    const jsdocContent = match[1];
    return extractJSDocContent(jsdocContent);
}

function extractJSDocContent(jsdocContent) {
    // Extract description (text after @description tag, before next tag or end)
    const descriptionMatch = jsdocContent.match(/@description\s*\n\s*\*\s*([\s\S]*?)(?=\n\s*\*\s*@|\n\s*$)/);

    let description = '';
    if (descriptionMatch) {
        // Found @description tag, extract the text after it
        description = descriptionMatch[1]
            .split('\n')
            .map(line => line.replace(/^\s*\*\s?/, '').trim())
            .join(' ')
            .trim();
    } else {
        // No @description tag, try to get first paragraph
        const firstParagraphMatch = jsdocContent.match(/^\s*\*\s*([\s\S]*?)(?=\n\s*\*\s*@|\n\s*$)/);
        if (firstParagraphMatch) {
            description = firstParagraphMatch[1]
                .split('\n')
                .map(line => line.replace(/^\s*\*\s?/, '').trim())
                .filter(line => line.length > 0)
                .join(' ')
                .trim();
        }
    }

    // Extract @example blocks
    const exampleMatches = jsdocContent.matchAll(/@example\s*\n([\s\S]*?)(?=\n\s*\*\s*@|$)/g);
    const examples = [];

    for (const match of exampleMatches) {
        const exampleContent = match[1]
            .split('\n')
            .map(line => line.replace(/^\s*\*\s?/, ''))
            .join('\n')
            .trim();

        if (exampleContent) {
            examples.push(exampleContent);
        }
    }

    // Combine description and examples into a single markdown string
    let result = description;

    if (examples.length > 0) {
        if (result) {
            result += '\n\n';
        }
        result += examples.join('\n\n');
    }

    return result || null;
}

/**
 * This is a build-time helper that gets replaced by the extractJSDocPlugin.
 * It extracts JSDoc documentation from a component file and inlines it into the story metadata.
 *
 * At build time:
 * 1. The extractJSDocPlugin finds calls to withDescription()
 * 2. Reads the component source file
 * 3. Extracts the JSDoc description and @example blocks
 * 4. Inlines them into parameters.docs.description.component
 * 5. Removes this import statement
 *
 * This function is just a placeholder for development-time type checking.
 */
export function withDescription(importMetaUrl, componentPath) {
    // This returns an empty object at runtime
    // The actual description will be inlined by the build plugin
    return {};
}

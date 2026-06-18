import { log } from '@clack/prompts';
import { SourceFile, SyntaxKind } from 'ts-morph';

import { addImportsToFile } from '../../../../utilities/ast-utils';

/**
 * Radix namespace → flat component name mapping.
 * Used to rewrite `Dialog.Root` → `Dialog`, `Dialog.Trigger` → `DialogTrigger`, etc.
 */
const NAMESPACE_MEMBER_MAP: Record<string, string> = {
    Root: '',
    Trigger: 'Trigger',
    Content: 'Content',
    Close: 'Close',
    Title: 'Title',
    Description: 'Description',
    Header: 'Header',
    Footer: 'Footer',
    Overlay: 'Overlay',
    Portal: 'Portal',
    Item: 'Item',
    Separator: 'Separator',
    Group: 'Group',
    Label: 'Label',
    Sub: 'Sub',
    SubTrigger: 'SubTrigger',
    SubContent: 'SubContent',
    Indicator: 'Indicator',
    Icon: 'Icon',
    Action: 'Action',
    Cancel: 'Cancel',
    Viewport: 'Viewport',
    ScrollUpButton: 'ScrollUpButton',
    ScrollDownButton: 'ScrollDownButton',
    Value: 'Value',
    Arrow: 'Arrow',
    Thumb: 'Thumb',
    Track: 'Track',
    Range: 'Range',
    List: 'List',
    Link: 'Link',
};

/**
 * Symbols re-exported from `@vendure/dashboard` that extensions should
 * not import directly from third-party packages. Maps package name →
 * set of symbol names that can be redirected.
 *
 * Note: `@lingui/react/macro` (Trans, useLingui from the macro path)
 * is NOT included — Babel macros cannot be re-exported.
 * Actual icon components from `lucide-react` are also excluded — only
 * the `LucideIcon` type is re-exported.
 */
const REEXPORTED_SYMBOLS: Record<string, Set<string>> = {
    'react-hook-form': new Set([
        'Controller',
        'FormProvider',
        'useFieldArray',
        'useForm',
        'useFormContext',
        'useWatch',
        'Control',
        'ControllerFieldState',
        'ControllerProps',
        'ControllerRenderProps',
        'FieldPath',
        'FieldValues',
        'UseFormReturn',
    ]),
    '@tanstack/react-query': new Set([
        'keepPreviousData',
        'queryOptions',
        'useInfiniteQuery',
        'useMutation',
        'useQuery',
        'useQueryClient',
        'useSuspenseQuery',
        'DefinedInitialDataOptions',
        'QueryClient',
        'UseMutationOptions',
        'UseQueryOptions',
    ]),
    '@tanstack/react-router': new Set([
        'Link',
        'Outlet',
        'useBlocker',
        'useNavigate',
        'useRouter',
        'useRouterState',
        'AnyRoute',
        'LinkProps',
        'RouteOptions',
    ]),
    '@tanstack/react-table': new Set([
        'AccessorFnColumnDef',
        'CellContext',
        'Column',
        'ColumnDef',
        'ColumnFiltersState',
        'ColumnSort',
        'ExpandedState',
        'HeaderContext',
        'Row',
        'RowSelectionState',
        'SortingState',
        'Table',
        'VisibilityState',
    ]),
    '@lingui/react': new Set(['useLingui']),
    '@lingui/core': new Set(['I18n', 'MessageDescriptor', 'Messages']),
    'lucide-react': new Set(['LucideIcon']),
    sonner: new Set(['toast']),
};

/**
 * Rewrites imports from Radix UI, @vendure-io/ui, @base-ui/react, and
 * third-party packages that are re-exported from `@vendure/dashboard`.
 * Also rewrites namespace member access sites
 * (e.g. `Dialog.Root` → `Dialog`, `Dialog.Trigger` → `DialogTrigger`).
 */
export function transformImportConsolidation(sourceFile: SourceFile): number {
    let changeCount = 0;

    const importDeclarations = sourceFile.getImportDeclarations();
    const collectedNamedImports: string[] = [];
    const declarationsToRemove: typeof importDeclarations = [];

    for (const importDecl of importDeclarations) {
        const moduleSpecifier = importDecl.getModuleSpecifier().getLiteralValue();

        const isRadixUi = moduleSpecifier.startsWith('@radix-ui/');
        const isVendureIoUi = moduleSpecifier.startsWith('@vendure-io/ui');
        const isBaseUi = moduleSpecifier.startsWith('@base-ui/react');
        const reexportedSet = REEXPORTED_SYMBOLS[moduleSpecifier];

        // Handle third-party packages with re-exported symbols
        if (!isRadixUi && !isVendureIoUi && !isBaseUi && reexportedSet) {
            const thirdPartyImports = importDecl.getNamedImports();
            const toMove: string[] = [];
            const toKeep: string[] = [];

            for (const ni of thirdPartyImports) {
                const name = ni.getName();
                const alias = ni.getAliasNode();
                const importStr = alias ? `${name} as ${alias.getText()}` : name;
                if (reexportedSet.has(name)) {
                    toMove.push(importStr);
                } else {
                    toKeep.push(importStr);
                }
            }

            if (toMove.length > 0) {
                collectedNamedImports.push(...toMove);
                if (toKeep.length === 0) {
                    // All imports can be moved — remove entire declaration
                    declarationsToRemove.push(importDecl);
                } else {
                    // Some imports stay — remove only the ones we're moving
                    for (const ni of thirdPartyImports) {
                        if (reexportedSet.has(ni.getName())) {
                            ni.remove();
                        }
                    }
                }
                changeCount++;
            }
            continue;
        }

        if (!isRadixUi && !isVendureIoUi && !isBaseUi) {
            continue;
        }

        // Handle namespace imports: `import * as Dialog from '@radix-ui/react-dialog'`
        const namespaceImport = importDecl.getNamespaceImport();
        if (namespaceImport) {
            const nsName = namespaceImport.getText();
            const rewrittenNames = rewriteNamespaceUsages(sourceFile, nsName);
            for (const name of rewrittenNames) {
                collectedNamedImports.push(name);
            }
            declarationsToRemove.push(importDecl);
            changeCount++;
            continue;
        }

        // Collect default imports as named imports
        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) {
            collectedNamedImports.push(defaultImport.getText());
        }

        // Collect named imports
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
            const alias = namedImport.getAliasNode();
            if (alias) {
                collectedNamedImports.push(`${namedImport.getName()} as ${alias.getText()}`);
            } else {
                collectedNamedImports.push(namedImport.getName());
            }
        }

        if (namedImports.length > 0 || defaultImport) {
            declarationsToRemove.push(importDecl);
            changeCount++;
        }
    }

    if (collectedNamedImports.length === 0) {
        return 0;
    }

    // Remove old import declarations (iterate in reverse to preserve indices)
    for (let i = declarationsToRemove.length - 1; i >= 0; i--) {
        declarationsToRemove[i].remove();
    }

    // Deduplicate collected imports
    const uniqueImports = [...new Set(collectedNamedImports)];

    // Add consolidated import using the shared utility
    addImportsToFile(sourceFile, {
        moduleSpecifier: '@vendure/dashboard',
        namedImports: uniqueImports,
    });

    return changeCount;
}

/**
 * Rewrites all usage sites of a namespace import (e.g. `Dialog.Root` → `Dialog`)
 * throughout the source file. Returns the set of flat component names that were
 * introduced, so they can be added as named imports.
 */
function rewriteNamespaceUsages(sourceFile: SourceFile, namespaceName: string): string[] {
    const introducedNames = new Set<string>();

    // Find all property access expressions like `Dialog.Root`, `Dialog.Trigger`
    const propertyAccesses = sourceFile
        .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
        .filter(pa => pa.getExpression().getText() === namespaceName);

    for (const pa of [...propertyAccesses].reverse()) {
        const memberName = pa.getName();
        const suffix = NAMESPACE_MEMBER_MAP[memberName];

        let flatName: string;
        if (suffix === undefined) {
            // Unknown member — use NamespaceMember as the flat name and warn
            flatName = `${namespaceName}${memberName}`;
            log.warn(
                `${sourceFile.getFilePath()}:${pa.getStartLineNumber()} — ` +
                    `Unknown namespace member ${namespaceName}.${memberName}, mapped to ${flatName}`,
            );
        } else if (suffix === '') {
            // .Root → just the namespace name (e.g. Dialog.Root → Dialog)
            flatName = namespaceName;
        } else {
            // .Trigger → NamespaceTrigger (e.g. Dialog.Trigger → DialogTrigger)
            flatName = `${namespaceName}${suffix}`;
        }

        pa.replaceWithText(flatName);
        introducedNames.add(flatName);
    }

    // Also handle JSX tag usage: <Dialog.Root> ... </Dialog.Root>
    // ts-morph represents these as JsxOpeningElement/JsxClosingElement with dotted tag names
    const fullText = sourceFile.getFullText();
    const jsxPattern = new RegExp(`${namespaceName}\\.(\\w+)`, 'g');
    let replaced = false;

    // Use a single pass to replace any remaining dotted references in JSX
    const newText = fullText.replace(jsxPattern, (_match, member: string) => {
        const suffix = NAMESPACE_MEMBER_MAP[member];
        let flatName: string;
        if (suffix === undefined) {
            flatName = `${namespaceName}${member}`;
        } else if (suffix === '') {
            flatName = namespaceName;
        } else {
            flatName = `${namespaceName}${suffix}`;
        }
        introducedNames.add(flatName);
        replaced = true;
        return flatName;
    });

    if (replaced) {
        sourceFile.replaceWithText(newText);
    }

    // If no usages were found at all, still import the namespace name itself
    if (introducedNames.size === 0) {
        introducedNames.add(namespaceName);
    }

    return [...introducedNames];
}

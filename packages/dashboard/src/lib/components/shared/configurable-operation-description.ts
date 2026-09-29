import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';

type ConfigurableOperationArgDef = ConfigurableOperationDefFragment['args'][number];

/**
 * @description
 * A segment of a parsed configurable operation description template.
 * Text segments are rendered as-is; arg segments correspond to an argument
 * of the operation and are rendered as interactive values.
 *
 * @docsCategory components
 * @docsPage ConfigurableOperationSentence
 * @since 3.6.0
 */
export type OperationDescriptionSegment =
    | { type: 'text'; text: string }
    | { type: 'arg'; arg: ConfigurableOperationArgDef; referenced: boolean };

const PLACEHOLDER_RE = /{\s*([a-zA-Z0-9]+)\s*}/g;

export function descriptionIncludesAdjacentAffix(
    text: string | undefined,
    affix: string | undefined,
    side: 'before' | 'after',
): boolean {
    if (!text || !affix) {
        return false;
    }
    return side === 'before' ? text.trimEnd().endsWith(affix) : text.trimStart().startsWith(affix);
}

/**
 * @description
 * Parses a configurable operation's description template (e.g.
 * `"buy at least { minimum } of the specified products"`) into an ordered list
 * of segments. Placeholders which match an argument of the operation become
 * `arg` segments; args never referenced in the template are appended as
 * trailing `arg` segments with `referenced: false` so that every argument is
 * always representable in the rendered sentence.
 *
 * @docsCategory components
 * @docsPage ConfigurableOperationSentence
 * @since 3.6.0
 */
export function parseOperationDescription(
    operationDefinition: Pick<ConfigurableOperationDefFragment, 'description' | 'args'>,
): OperationDescriptionSegment[] {
    const { description, args } = operationDefinition;
    const segments: OperationDescriptionSegment[] = [];
    const referencedArgNames = new Set<string>();

    let lastIndex = 0;
    for (const match of description.matchAll(PLACEHOLDER_RE)) {
        const placeholder = match[1];
        // Match legacy interpolateDescription behavior: case-insensitive lookup
        const arg = args.find(a => a.name.toLowerCase() === placeholder.toLowerCase());
        if (!arg) {
            // Unknown placeholder: leave it in the text verbatim
            continue;
        }
        if (match.index > lastIndex) {
            segments.push({ type: 'text', text: description.slice(lastIndex, match.index) });
        }
        segments.push({ type: 'arg', arg, referenced: true });
        referencedArgNames.add(arg.name);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < description.length) {
        segments.push({ type: 'text', text: description.slice(lastIndex) });
    }

    for (const arg of args) {
        if (!referencedArgNames.has(arg.name) && arg.ui?.component !== 'combination-mode-form-input') {
            segments.push({ type: 'arg', arg, referenced: false });
        }
    }

    return segments;
}

/**
 * @description
 * Formats a scalar configurable operation arg value for compact display,
 * applying the same currency precision and date formatting rules as
 * {@link interpolateDescription}. Returns `undefined` for empty values.
 *
 * @docsCategory components
 * @docsPage ConfigurableOperationSentence
 * @since 3.6.0
 */
export function formatScalarArgValue(
    arg: Pick<ConfigurableOperationArgDef, 'type' | 'ui'>,
    value: string | undefined,
    precisionFactor = 2,
): string | undefined {
    if (value == null || value === '') {
        return undefined;
    }
    if (arg.type === 'int' && arg.ui?.component === 'currency-form-input') {
        return (Number(value) / Math.pow(10, precisionFactor)).toString();
    }
    if (arg.type === 'datetime' && (value as any) instanceof Date) {
        return (value as any).toLocaleDateString();
    }
    return value;
}

import { ManipulationSettings, QuoteKind } from 'ts-morph';

export const defaultManipulationSettings: Partial<ManipulationSettings> = {
    quoteKind: QuoteKind.Single,
    useTrailingCommas: true,
};
export const pascalCaseRegex = /^[A-Z][a-zA-Z0-9]*$/;
/** A plugin name as `vendure add plugin` takes it, such as `reviews`. */
export const pluginNameRegex = /^[a-z][a-z-0-9]+$/;

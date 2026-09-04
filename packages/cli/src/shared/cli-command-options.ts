import { Option } from 'commander';

import { CliCommandOption } from './cli-command-definition';

/**
 * Builds the Commander flags string for an option, e.g. `-p, --plugin [name]`.
 *
 * Options that are not marked `required` have their value placeholder relaxed
 * from `<value>` to `[value]`, so `--plugin <name>` can also be passed as a
 * bare `--plugin`.
 */
export function buildOptionFlags(option: CliCommandOption): string {
    const parts: string[] = [];
    if (option.short) {
        parts.push(option.short);
    }
    parts.push(option.long);

    const flags = parts.join(', ');
    return option.required ? flags : flags.replace(/<([^>]+)>/g, '[$1]');
}

export interface ParsedCliOption {
    /** The long flag including dashes, e.g. `--plugin`. */
    long?: string;
    /** The short flag including the dash, e.g. `-p`. */
    short?: string;
    /** The key the parsed value is stored under, e.g. `plugin`. */
    attributeName: string;
    /** Whether a value follows the flag, required or optional. */
    takesValue: boolean;
}

/**
 * Resolves a definition's flags the same way Commander does, so that collision
 * detection and registration always agree on what a flag is called.
 */
export function parseOptionFlags(option: CliCommandOption): ParsedCliOption {
    const parsed = new Option(buildOptionFlags(option), option.description);
    return {
        long: parsed.long ?? undefined,
        short: parsed.short ?? undefined,
        attributeName: parsed.attributeName(),
        takesValue: parsed.required || parsed.optional,
    };
}

/**
 * An option together with every sub-option it declares. Sub-options are
 * registered on the same Commander command as their parent, so every check
 * that applies to an option applies to them too.
 */
export function withSubOptions(options: CliCommandOption[]): CliCommandOption[] {
    return options.flatMap(option => [option, ...withSubOptions(option.subOptions ?? [])]);
}

/**
 * How an option is named in error messages.
 */
export function describeOption(option: CliCommandOption): string {
    const { long, short } = parseOptionFlags(option);
    return [short, long].filter(Boolean).join(', ');
}

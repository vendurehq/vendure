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
    };
}

/**
 * How an option is named in error messages.
 */
export function describeOption(option: CliCommandOption): string {
    const { long, short } = parseOptionFlags(option);
    return [short, long].filter(Boolean).join(', ');
}

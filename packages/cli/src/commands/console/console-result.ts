import type { CommandNeed, InputNeed } from '@vendure/common/lib/command';

/**
 * A required setup input. Contains names and repair commands, never values.
 *
 * @deprecated Return `needs` from a hook instead. `vendure console link` turns these into `input`
 * needs in its result.
 * @since 3.8.0
 */
export interface ConsoleMissingInput {
    input: string;
    flag?: string;
    command?: string;
    argument?: string;
    environment?: string[];
}

/** JSON data supplied by a plugin. Do not include credentials or tokens. @since 3.8.0 */
export type ConsoleResultData =
    | null
    | boolean
    | number
    | string
    | ConsoleResultData[]
    | { [key: string]: ConsoleResultData };

/** Safe setup status contributed by one hook. @since 3.8.0 */
export interface ConsoleLinkResultContribution {
    outcome: 'configured' | 'incomplete' | 'failed';
    data: ConsoleResultData;
    /**
     * What the caller must supply or do before setup can finish, in the shape every CLI command
     * uses.
     *
     * @since 4.0.0
     */
    needs?: CommandNeed[];
    /** @deprecated Use `needs`. Each entry becomes an `input` need. */
    missingInputs?: ConsoleMissingInput[];
    nextSteps?: string[];
}

/** The single Console result written to stdout in JSON mode. @since 3.8.0 */
export interface ConsoleCommandResult {
    schemaVersion: 1;
    operation: string;
    outcome: 'linked' | 'repaired' | 'read' | 'unlinked' | 'incomplete' | 'failed';
    data: {
        link?: { outcome: 'linked' | 'repaired'; manifestPath: string };
        plugins: Record<string, ConsoleResultData>;
    };
    /**
     * What the caller must supply or do before the command can finish: a credential, a flag, or a
     * step for a person. Replaces `missingInputs`.
     *
     * @since 4.0.0
     */
    needs: CommandNeed[];
    nextSteps: string[];
}

/** Turns a hook's {@link ConsoleMissingInput} into the `input` need it stands for. */
export function missingInputToNeed(missing: ConsoleMissingInput): InputNeed {
    const ways = [
        missing.flag ? `pass ${missing.flag}` : undefined,
        missing.argument ? `pass the ${missing.argument} argument` : undefined,
        missing.environment?.length ? `set ${missing.environment.join(' or ')}` : undefined,
        missing.command ? `run ${missing.command}` : undefined,
    ].filter((way): way is string => way !== undefined);
    return {
        kind: 'input',
        field: missing.input,
        description: ways.length ? `${missing.input}: ${ways.join(', or ')}` : missing.input,
    };
}

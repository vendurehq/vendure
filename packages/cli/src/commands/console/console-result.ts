/** A required setup input. Contains names and repair commands, never values. @since 3.8.0 */
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
    missingInputs: ConsoleMissingInput[];
    nextSteps: string[];
}

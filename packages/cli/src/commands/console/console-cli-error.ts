/**
 * An error whose message the CLI wrote, with no response body, credential or hook output in it.
 * `vendure console` reports its message as it is, also when no person reads the output. An error
 * the CLI did not write, such as one a plugin hook threw, is reported in general terms then.
 */
export class ConsoleCliError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConsoleCliError';
    }
}

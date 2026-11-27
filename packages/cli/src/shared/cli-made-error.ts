/**
 * An error whose message the CLI wrote. It holds no response body, credential or text from a plugin:
 * at most a status code or an error code that names what went wrong. So a command can report its
 * message as it is, also when no person reads the output. An error that is not one of these, such
 * as one a plugin hook threw, may hold anything, and is reported in general terms then.
 */
export class CliMadeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CliMadeError';
    }
}

/** Whether the CLI wrote `error`'s message, so it can be reported as it is. */
export function isCliMadeError(error: unknown): error is CliMadeError {
    return error instanceof CliMadeError;
}

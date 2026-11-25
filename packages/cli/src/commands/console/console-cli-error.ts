import { CliMadeError } from '../../shared/cli-made-error.js';

/** A {@link CliMadeError} that `vendure console` throws. */
export class ConsoleCliError extends CliMadeError {
    constructor(message: string) {
        super(message);
        this.name = 'ConsoleCliError';
    }
}

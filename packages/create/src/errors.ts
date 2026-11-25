/**
 * An error create reports with a stable code. With `--json` it is printed as
 * `{error: {code, message, fix}}`, and create exits with a non-zero code.
 */
export class CreateError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly fix?: string,
    ) {
        super(message);
        this.name = 'CreateError';
    }

    toJSON(): { error: { code: string; message: string; fix?: string } } {
        return { error: { code: this.code, message: this.message, ...(this.fix ? { fix: this.fix } : {}) } };
    }
}

/** Any thrown value as a {@link CreateError}, so every failure has a code. */
export function toCreateError(e: unknown): CreateError {
    if (e instanceof CreateError) {
        return e;
    }
    return new CreateError('create.failed', e instanceof Error ? e.message : String(e));
}

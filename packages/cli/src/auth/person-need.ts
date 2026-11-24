import { PersonNeed } from '@vendure/common/lib/command';

/** The code of the refusal Vendure Cloud and Vendure Console send a delegated key on a step only a person may take. */
export const PERSON_REQUIRED_CODE = 'PERSON_REQUIRED';

/**
 * What each step that needs a person is, in words a caller can show a person. Unknown actions
 * still map to a need, with a general summary, so a new server-side step works before the CLI
 * knows its name.
 */
const PERSON_ACTION_SUMMARIES: Record<string, string> = {
    'production-request': 'Request production for the project in Vendure Console',
    'environment-delete': 'Delete the environment in Vendure Console',
    'database-restore': 'Restore the database in Vendure Console',
    teardown: 'Tear down the environment in Vendure Console',
    'env-vars-replace-all': 'Replace all environment variables in Vendure Console',
    'env-vars-delete': 'Delete the environment variables in Vendure Console',
    'desired-state': 'Change the environment in Vendure Console',
    'runtime-operation': 'Run the operation in Vendure Console',
    'initial-credentials': 'Read the initial credentials in Vendure Console',
};

/** @since 4.0.0 */
export interface PersonNeedContext {
    /** The Vendure Console the need links to, such as `https://console.vendure.io`. */
    consoleUrl: string;
    /** A Console path that shows the step, such as `/projects/<id>`. Defaults to the Console home page. */
    path?: string;
}

/**
 * Turns a refusal from Vendure Cloud or Vendure Console into a `person` need: a step that only a
 * person may take, with a Console link where they take it. Returns `undefined` for any other
 * error, so a caller can try this first and handle the rest as before.
 *
 * Put the need in an `incomplete` result. The caller runs the same command again once the person
 * has acted; nothing is stored in between.
 *
 * @since 4.0.0
 */
export function personNeedFromApiError(error: unknown, context: PersonNeedContext): PersonNeed | undefined {
    const body = refusalBody(error);
    if (!body) {
        return undefined;
    }
    // Joined as strings, so a Console served under a path keeps it.
    const url = `${context.consoleUrl.replace(/\/+$/, '')}/${(context.path ?? '').replace(/^\/+/, '')}`;
    return {
        kind: 'person',
        action: body.action,
        summary: PERSON_ACTION_SUMMARIES[body.action] ?? 'A person must take this step in Vendure Console',
        url,
    };
}

/**
 * The `PERSON_REQUIRED` body, whether the caller passes the parsed body itself or an error that
 * carries it as `body`, `response.body` or `data`, the shapes HTTP clients use.
 */
function refusalBody(error: unknown): { action: string } | undefined {
    for (const candidate of [
        error,
        read(error, 'body'),
        read(read(error, 'response'), 'body'),
        read(read(error, 'response'), 'data'),
        read(error, 'data'),
    ]) {
        const code = read(candidate, 'code');
        const action = read(candidate, 'action');
        if (code === PERSON_REQUIRED_CODE && typeof action === 'string' && action.length > 0) {
            return { action };
        }
    }
    return undefined;
}

function read(value: unknown, key: string): unknown {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

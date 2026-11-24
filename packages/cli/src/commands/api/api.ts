import { CommandContext, ErrorResult, fail, failed, isErrorResult } from '@vendure/common/lib/command';
import pc from 'picocolors';

import {
    GraphqlResponse,
    localAdminApiErrors,
    localAdminGraphql,
    readGraphqlResponse,
    resolveLocalShopApiUrl,
} from '../../shared/local-admin-api.js';
import { projectResolutionFailure, resolveDevServerStateProject } from '../devserver/devserver.js';

import { apiErrors } from './api.errors.js';

export interface ApiInput {
    target: 'admin' | 'shop';
    query: string;
    variables?: string;
}

/**
 * Runs one GraphQL operation on the local dev server. GraphQL errors are output, not command
 * errors, so their `extensions.requestId` can be passed to `vendure explain`. A response with
 * errors ends the command as `failed`.
 */
export async function run(input: ApiInput, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerStateProject(ctx);
    } catch (e) {
        return projectResolutionFailure(e);
    }
    const variables = parseVariables(input.variables);
    if (isErrorResult(variables)) {
        return variables;
    }
    const operation = { query: input.query, ...(variables ? { variables } : {}) };
    const response =
        input.target === 'admin'
            ? await localAdminGraphql(projectDir, operation, { signal: ctx.signal })
            : await runShopOperation(projectDir, operation, ctx.signal);
    if (isErrorResult(response)) {
        return response;
    }
    return response.errors?.length ? failed(response) : response;
}

function parseVariables(text: string | undefined): Record<string, unknown> | undefined | ErrorResult {
    if (text === undefined) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return fail(apiErrors.invalidVariables, { message: (e as Error).message });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return fail(apiErrors.invalidVariables, { message: 'it is not an object' });
    }
    return parsed as Record<string, unknown>;
}

/** Calls the Shop API with no credential, the same as a storefront. */
async function runShopOperation(
    projectDir: string,
    operation: { query: string; variables?: Record<string, unknown> },
    signal: AbortSignal,
): Promise<GraphqlResponse | ErrorResult> {
    const url = resolveLocalShopApiUrl(projectDir);
    if (isErrorResult(url)) {
        return url;
    }
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(operation),
            signal,
        });
        return await readGraphqlResponse(response);
    } catch (e: unknown) {
        if (signal.aborted) {
            throw e;
        }
        const cause = (e as { cause?: { code?: string } })?.cause;
        return fail(localAdminApiErrors.unreachable, {
            url,
            message: cause?.code ?? (e instanceof Error ? e.message : String(e)),
        });
    }
}

export function render(output: GraphqlResponse): string {
    const lines: string[] = [];
    if (output.data !== undefined) {
        lines.push(JSON.stringify(output.data, null, 2));
    }
    for (const error of output.errors ?? []) {
        const code = error.extensions?.vendureCode ?? error.extensions?.code;
        const requestId = error.extensions?.requestId;
        lines.push(
            `${pc.red('error')}${typeof code === 'string' ? ` ${pc.gray(`(${code})`)}` : ''} ${error.message}`,
        );
        if (typeof requestId === 'string') {
            lines.push(`  ${pc.gray('vendure explain')} ${requestId}`);
        }
    }
    return lines.join('\n');
}

import { CommandContext, ErrorResult, fail, failed, isErrorResult } from '@vendure/common/lib/command';
import { DEFAULT_CHANNEL_TOKEN_KEY } from '@vendure/common/lib/shared-constants';
import pc from 'picocolors';

import { GraphqlResponse, localAdminGraphql, localShopGraphql } from '../../shared/local-admin-api.js';
import { projectResolutionFailure, resolveDevServerStateProject } from '../devserver/devserver.js';

import { apiErrors } from './api.errors.js';

export interface ApiInput {
    target: 'admin' | 'shop';
    query: string;
    variables?: string;
    operationName?: string;
    channelToken?: string;
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
    const operation = {
        query: input.query,
        ...(variables ? { variables } : {}),
        ...(input.operationName ? { operationName: input.operationName } : {}),
    };
    const options = {
        signal: ctx.signal,
        ...(input.channelToken ? { headers: { [DEFAULT_CHANNEL_TOKEN_KEY]: input.channelToken } } : {}),
    };
    const response =
        input.target === 'admin'
            ? await localAdminGraphql(projectDir, operation, options)
            : await localShopGraphql(projectDir, operation, options);
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

export function render(output: GraphqlResponse): string {
    const lines: string[] = [];
    if (output.data !== undefined && output.data !== null) {
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

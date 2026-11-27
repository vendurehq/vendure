import { CommandContext, fail, failed, isErrorResult } from '@vendure/common/lib/command';

import { localAdminGraphql } from '../../../shared/local-admin-api.js';
import { readDevServerState } from '../../dev/state-file.js';
import { projectResolutionFailure, resolveDevServerStateProject } from '../../devserver/devserver.js';

import { storeCheckErrors } from './store-check.errors.js';
import { StoreCheckFinding, StoreCheckOutput } from './store-check.schema.js';

const STORE_READINESS_QUERY = /* GraphQL */ `
    query StoreReadiness {
        storeReadiness {
            ready
            findings {
                code
                severity
                message
                channelId
                zoneId
                countryCode
                taxCategoryId
                fixes {
                    path
                    input
                    description
                }
                dashboardUrl
            }
        }
    }
`;

interface StoreReadinessData {
    storeReadiness: { ready: boolean; findings: StoreCheckFinding[] };
}

/**
 * Runs the `storeReadiness` query on the Admin API of the `vendure dev` run serving the project, as
 * the superadmin, so every channel is checked. A report that is not ready is a `failed` result: the
 * report is still the output, and the exit code is not zero.
 */
export async function run(_input: Record<string, never>, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerStateProject(ctx);
    } catch (e) {
        return projectResolutionFailure(e);
    }
    const response = await localAdminGraphql<StoreReadinessData>(
        projectDir,
        { query: STORE_READINESS_QUERY, operationName: 'StoreReadiness' },
        { signal: ctx.signal },
    );
    if (isErrorResult(response)) {
        return response;
    }
    const error = response.errors?.[0];
    if (error || !response.data?.storeReadiness) {
        if (error && /Cannot query field "storeReadiness"/.test(error.message)) {
            return fail(storeCheckErrors.notSupported, {});
        }
        // Only the McpPlugin's local trust accepts the per-run secret. Without it, the request runs
        // as an anonymous user, whom the query refuses.
        if (error?.extensions?.code === 'FORBIDDEN') {
            return fail(storeCheckErrors.notAuthorized, {});
        }
        const requestId = error?.extensions?.requestId;
        return fail(storeCheckErrors.queryFailed, {
            message: error?.message ?? 'The response has no report.',
            requestId: typeof requestId === 'string' ? requestId : undefined,
        });
    }
    const dashboard = readDevServerState(projectDir)?.urls.dashboard;
    const report: StoreCheckOutput = {
        ...response.data.storeReadiness,
        ...(dashboard ? { dashboard } : {}),
    };
    return report.ready ? report : failed(report);
}

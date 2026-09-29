import { describe, expect, it, vi } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';

import { McpOauthRetentionService } from './oauth-retention.service';

function build() {
    const getRepository = vi.fn();
    const service = new McpOauthRetentionService(
        { getRepository } as any,
        {} as any,
        resolveMcpPluginOptions({ oauth: { tokenSecret: 's', grantRetentionDays: 0 } }),
    );
    return { service, getRepository };
}

describe('McpOauthRetentionService dead-grant retention', () => {
    it('does not query dead grants when grantRetentionDays is 0', async () => {
        const { service, getRepository } = build();
        const result = await (service as any).deleteDeadGrants({});
        expect(result).toBe(0);
        expect(getRepository).not.toHaveBeenCalled();
    });
});

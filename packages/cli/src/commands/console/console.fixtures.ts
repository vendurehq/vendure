import type { ProjectLinkManifest } from './project-link-manifest';

export const NOW = Date.parse('2026-08-19T10:00:00.000Z');
export const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
export const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
export const LINK_ID = '33333333-3333-4333-8333-333333333333';
export const OTHER_LINK_ID = '44444444-4444-4444-8444-444444444444';
export const POLLING_SECRET = 'one-time-polling-secret';

export const manifest: ProjectLinkManifest = {
    schemaVersion: 1,
    project: { id: PROJECT_ID, name: 'Storefront' },
    account: { id: ACCOUNT_ID, name: 'Acme' },
    link: { id: LINK_ID, protocolVersion: 1 },
};

export function expiry(): string {
    return new Date(NOW + 10 * 60 * 1_000).toISOString();
}

export function createResponse(expiresAt = expiry()) {
    return {
        id: LINK_ID,
        state: 'pending',
        protocolVersion: 1,
        expiresAt,
        pollingSecret: POLLING_SECRET,
        verificationPath: `/?link=${LINK_ID}`,
    };
}

import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';

const SECOND_CHANNEL_TOKEN = 'second_channel_token';

/**
 * Regression guard: a non-SuperAdmin administrator must not be able to escalate to
 * SuperAdmin by assigning roles it does not have the permissions for.
 *
 * Reported as GHSA-rcgx-8gc8-92v7 (privilege escalation via `assignRoleToAdministrator`)
 * and closed as not reproducible: `assignRole` has no explicit authorization check, but it
 * calls `roleService.findOne`, whose `activeUserHasPermissionsOnChannelsOf` requires the caller to already
 * hold every permission in the role, so the SuperAdmin grant is refused. This suite pins
 * that guarantee from five attack angles with a maximally-privileged attacker (every
 * admin/role management permission short of SuperAdmin), verifying persisted roles in the
 * DB rather than trusting the session cache. If any vector starts succeeding, the
 * authorization has regressed.
 *
 * Run: cd packages/core && DB=sqljs PACKAGE=core ../../node_modules/.bin/vitest \
 *   --config ../../e2e-common/vitest.config.mts --run administrator-role-escalation
 */

const ACTIVE_ADMIN = gql`
    query {
        activeAdministrator {
            id
            user {
                roles {
                    code
                }
            }
        }
    }
`;

const GET_ADMIN_ROLES = gql`
    query ($id: ID!) {
        administrator(id: $id) {
            id
            user {
                roles {
                    code
                }
            }
        }
    }
`;

const GET_ROLES = gql`
    query {
        roles(options: { take: 100 }) {
            items {
                id
                code
            }
        }
    }
`;

const ASSIGN_ROLE = gql`
    mutation ($administratorId: ID!, $roleId: ID!) {
        assignRoleToAdministrator(administratorId: $administratorId, roleId: $roleId) {
            id
        }
    }
`;

// The maximal admin/role-management set short of SuperAdmin. Role CRUD is gated by the
// Administrator permissions; there are no separate Role permissions in Vendure.
const ATTACKER_PERMISSIONS = [
    'ReadAdministrator',
    'CreateAdministrator',
    'UpdateAdministrator',
    'DeleteAdministrator',
    'ReadCatalog',
];

describe('Administrator role-escalation authorization (GHSA-rcgx-8gc8-92v7)', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const attacker = { emailAddress: 'attacker-admin@test.com', password: 'test-password' };
    const attackerB = { emailAddress: 'attacker-channel-b@test.com', password: 'test-password' };
    let attackerAdminId: string;
    let attackerBAdminId: string;
    let victimAdminId: string;
    let superAdminRoleId: string;
    let subsetRoleId: string;

    async function loginAsAttacker() {
        await adminClient.asUserWithCredentials(attacker.emailAddress, attacker.password);
    }

    // Reads an admin's persisted roles from the DB perspective (as SuperAdmin on the
    // default channel), the ground truth independent of session caching.
    async function adminDbRoles(adminId: string): Promise<string[]> {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();
        const { administrator } = await adminClient.query<any>(GET_ADMIN_ROLES, { id: adminId });
        return administrator.user.roles.map((r: any) => r.code);
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { roles } = await adminClient.query<any>(GET_ROLES);
        superAdminRoleId = roles.items.find((r: any) => r.code === SUPER_ADMIN_ROLE_CODE).id;

        const { createRole } = await adminClient.query<any>(createRoleDocument, {
            input: {
                code: 'attacker-role',
                description: 'Everything short of SuperAdmin',
                permissions: ATTACKER_PERMISSIONS,
                channelIds: ['1'],
            },
        });
        const { createRole: subset } = await adminClient.query<any>(createRoleDocument, {
            input: {
                code: 'catalog-reader',
                description: 'A subset of what the attacker holds',
                permissions: ['ReadCatalog'],
                channelIds: ['1'],
            },
        });
        subsetRoleId = subset.id;

        const { createAdministrator } = await adminClient.query<any>(createAdministratorDocument, {
            input: {
                emailAddress: attacker.emailAddress,
                firstName: 'Attacker',
                lastName: 'Admin',
                password: attacker.password,
                roleIds: [createRole.id],
            },
        });
        attackerAdminId = createAdministrator.id;

        const { createAdministrator: victim } = await adminClient.query<any>(createAdministratorDocument, {
            input: {
                emailAddress: 'victim-admin@test.com',
                firstName: 'Victim',
                lastName: 'Admin',
                password: 'victim-password',
                roleIds: [subsetRoleId],
            },
        });
        victimAdminId = victim.id;

        // A second channel, and an attacker scoped ONLY to it, to test that a channel-scoped
        // admin cannot reach the global SuperAdmin role from a different channel context.
        const { createChannel } = await adminClient.query<any>(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: 'en',
                currencyCode: 'GBP',
                pricesIncludeTax: true,
                defaultShippingZoneId: '1',
                defaultTaxZoneId: '1',
            },
        });
        const { createRole: channelBRole } = await adminClient.query<any>(createRoleDocument, {
            input: {
                code: 'channel-b-admin',
                description: 'Admin management on channel B only',
                permissions: ATTACKER_PERMISSIONS,
                channelIds: [createChannel.id],
            },
        });
        const { createAdministrator: attackerBAdmin } = await adminClient.query<any>(
            createAdministratorDocument,
            {
                input: {
                    emailAddress: attackerB.emailAddress,
                    firstName: 'AttackerB',
                    lastName: 'Admin',
                    password: attackerB.password,
                    roleIds: [channelBRole.id],
                },
            },
        );
        attackerBAdminId = attackerBAdmin.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await adminClient.asSuperAdmin();
        await server.destroy();
    });

    it('control: attacker CAN assign a role whose permissions it already holds', async () => {
        await loginAsAttacker();
        const { assignRoleToAdministrator } = await adminClient.query<any>(ASSIGN_ROLE, {
            administratorId: attackerAdminId,
            roleId: subsetRoleId,
        });
        expect(assignRoleToAdministrator.id).toBe(attackerAdminId);
    });

    it('vector 1: cannot self-escalate to SuperAdmin via assignRoleToAdministrator', async () => {
        await loginAsAttacker();
        let err: string | undefined;
        try {
            await adminClient.query<any>(ASSIGN_ROLE, {
                administratorId: attackerAdminId,
                roleId: superAdminRoleId,
            });
        } catch (e: any) {
            err = e.message ?? String(e);
        }
        expect(err).toBeDefined();
        expect(await adminDbRoles(attackerAdminId)).not.toContain(SUPER_ADMIN_ROLE_CODE);
    });

    it('vector 2: cannot self-escalate via updateAdministrator roleIds (sibling path)', async () => {
        await loginAsAttacker();
        let err: string | undefined;
        try {
            await adminClient.query<any>(updateAdministratorDocument, {
                input: { id: attackerAdminId, roleIds: [superAdminRoleId] },
            });
        } catch (e: any) {
            err = e.message ?? String(e);
        }
        expect(err).toBeDefined();
        expect(await adminDbRoles(attackerAdminId)).not.toContain(SUPER_ADMIN_ROLE_CODE);
    });

    it('vector 3: cannot create a SuperAdmin-permission role to then assign', async () => {
        await loginAsAttacker();
        let err: string | undefined;
        try {
            await adminClient.query<any>(createRoleDocument, {
                input: {
                    code: 'sneaky-superadmin',
                    description: 'attempt to mint a superadmin-equivalent role',
                    permissions: ['SuperAdmin'],
                    channelIds: ['1'],
                },
            });
        } catch (e: any) {
            err = e.message ?? String(e);
        }
        expect(err).toBeDefined();
    });

    it('vector 4: cannot push SuperAdmin onto another administrator', async () => {
        await loginAsAttacker();
        let err: string | undefined;
        try {
            await adminClient.query<any>(ASSIGN_ROLE, {
                administratorId: victimAdminId,
                roleId: superAdminRoleId,
            });
        } catch (e: any) {
            err = e.message ?? String(e);
        }
        expect(err).toBeDefined();

        await adminClient.asSuperAdmin();
        const { administrator } = await adminClient.query<any>(GET_ADMIN_ROLES, { id: victimAdminId });
        expect(administrator.user.roles.map((r: any) => r.code)).not.toContain(SUPER_ADMIN_ROLE_CODE);
    });

    it('vector 5: a channel-scoped admin cannot reach the global SuperAdmin role', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        await adminClient.asUserWithCredentials(attackerB.emailAddress, attackerB.password);
        let err: string | undefined;
        try {
            await adminClient.query<any>(ASSIGN_ROLE, {
                administratorId: attackerBAdminId,
                roleId: superAdminRoleId,
            });
        } catch (e: any) {
            err = e.message ?? String(e);
        }
        expect(err).toBeDefined();
        expect(await adminDbRoles(attackerBAdminId)).not.toContain(SUPER_ADMIN_ROLE_CODE);
    });

    it('summary: attacker never became SuperAdmin by any vector', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await loginAsAttacker();
        const active = await adminClient.query<any>(ACTIVE_ADMIN);
        const sessionRoles = active.activeAdministrator.user.roles.map((r: any) => r.code);
        const dbRoles = await adminDbRoles(attackerAdminId);
        expect(sessionRoles).not.toContain(SUPER_ADMIN_ROLE_CODE);
        expect(dbRoles).not.toContain(SUPER_ADMIN_ROLE_CODE);
    });
});

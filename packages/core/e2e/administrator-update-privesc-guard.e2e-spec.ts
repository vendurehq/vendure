import { Permission } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER } from '@vendure/common/lib/shared-constants';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createAdministratorDocument,
    createRoleDocument,
    getAdministratorsDocument,
    MeDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * `AdministratorService.update` must only allow the active user to modify an administrator over whom
 * they already hold sufficient permissions. This uses a dedicated environment rather than folding into
 * administrator.e2e-spec.ts, because that suite asserts fixed administrator counts across its sequential
 * tests and reassigns the SuperAdmin's identifier via updateActiveAdministrator, which would make
 * re-authenticating as the SuperAdmin here unreliable.
 */
describe('AdministratorService.update privilege-escalation guard', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const manager = { emailAddress: 'admin-manager@test.com', password: 'test-password' };
    let superAdminId: string;
    let staffId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { administrators } = await adminClient.query(getAdministratorsDocument);
        superAdminId = administrators.items.find(a => a.user.identifier === SUPER_ADMIN_USER_IDENTIFIER)!.id;

        // A "staff" administrator holding a narrow set of permissions.
        const { createRole: staffRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'staff',
                description: 'Catalog staff',
                permissions: [Permission.ReadCatalog],
                channelIds: ['T_1'],
            },
        });
        const { createAdministrator: staff } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: 'staff@test.com',
                firstName: 'Stan',
                lastName: 'Staff',
                password: 'test-password',
                roleIds: [staffRole.id],
            },
        });
        staffId = staff.id;

        // An "admin manager": not a SuperAdmin, but holds a superset of the staff permissions plus the
        // ability to manage administrators.
        const { createRole: managerRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'admin-manager',
                description: 'Can manage administrators',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.ReadAdministrator,
                    Permission.UpdateAdministrator,
                ],
                channelIds: ['T_1'],
            },
        });
        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: manager.emailAddress,
                firstName: 'Manny',
                lastName: 'Manager',
                password: manager.password,
                roleIds: [managerRole.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it(
        'blocks a non-SuperAdmin from resetting the SuperAdmin password',
        assertThrowsWithMessage(async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            await adminClient.query(updateAdministratorDocument, {
                input: { id: superAdminId, password: 'pwned' },
            });
        }, 'does not have sufficient permissions'),
    );

    it('leaves the SuperAdmin credentials intact after a blocked attempt', async () => {
        await adminClient.asSuperAdmin();
        const { me } = await adminClient.query(MeDocument);
        expect(me?.identifier).toBe(SUPER_ADMIN_USER_IDENTIFIER);
    });

    it('allows a non-SuperAdmin with sufficient permissions to update a lower-privileged administrator', async () => {
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        const { updateAdministrator } = await adminClient.query(updateAdministratorDocument, {
            input: { id: staffId, firstName: 'Updated', password: 'new-staff-password' },
        });
        expect(updateAdministrator.id).toBe(staffId);
        expect(updateAdministrator.firstName).toBe('Updated');
    });

    it('allows a SuperAdmin to update another administrator', async () => {
        await adminClient.asSuperAdmin();
        const { updateAdministrator } = await adminClient.query(updateAdministratorDocument, {
            input: { id: staffId, lastName: 'BySuperAdmin' },
        });
        expect(updateAdministrator.id).toBe(staffId);
        expect(updateAdministrator.lastName).toBe('BySuperAdmin');
    });
});

import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    DEFAULT_APIKEY_HEADER_KEY,
    ROLE_EDITOR_ROLE_CODE,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
import {
    Administrator,
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    RequestContext,
    Role,
    RoleAssignment,
    TransactionalConnection,
    User,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import fs from 'fs';
import gql from 'graphql-tag';
import path from 'path';
import { In, IsNull } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import { graphql as shopGraphql } from './graphql/graphql-shop';
import {
    assignRolesToUserDocument,
    createAdministratorDocument,
    createChannelDocument,
    createCustomerDocument,
    createRoleDocument,
    deleteAdministratorDocument,
    getAdministratorsDocument,
    getCustomerListDocument,
    getProductListDocument,
    MeDocument,
    removeRolesFromUserDocument,
    updateAdministratorDocument,
    updateProductDocument,
    updateRoleDocument,
} from './graphql/shared-definitions';

/**
 * OSS-792 — runtime pen-test of the RoleAssignment permission model. Each `it` is one row of
 * the attack matrix. Rows whose expected outcome is `deny` or `allow` assert it; `observe` and
 * `decide` rows record what happened. All outcomes are written to a JSON report at the end.
 */

type Expectation = 'deny' | 'allow' | 'observe' | 'decide';
interface Row {
    section: string;
    id: string;
    expect: Expectation;
    outcome: 'allowed' | 'denied';
    detail: string;
    verdict: 'pass' | 'FAIL' | 'observed';
}
const report: Row[] = [];

type Attempt = { ok: true; value: any } | { ok: false; message: string };
async function attempt(fn: () => Promise<any>): Promise<Attempt> {
    try {
        const value = await fn();
        return { ok: true, value };
    } catch (err: any) {
        return {
            ok: false,
            message: String(err?.message ?? err)
                .split('\n')[0]
                .slice(0, 300),
        };
    }
}

function record(section: string, id: string, expectation: Expectation, result: Attempt, extra?: string) {
    const outcome = result.ok ? 'allowed' : 'denied';
    const detail = result.ok ? (extra ?? 'ok') : result.message + (extra ? ` | ${extra}` : '');
    let verdict: Row['verdict'] = 'observed';
    if (expectation === 'deny') verdict = result.ok ? 'FAIL' : 'pass';
    if (expectation === 'allow') verdict = result.ok ? 'pass' : 'FAIL';
    report.push({ section, id, expect: expectation, outcome, detail, verdict });
    if (verdict === 'FAIL') {
        expect.fail(`[${section}] ${id}: expected ${expectation}, got ${outcome}: ${detail}`);
    }
}

function mustFind<T>(items: T[], predicate: (item: T) => boolean, what: string): T {
    const found = items.find(predicate);
    if (!found) throw new Error(`Expected to find ${what}`);
    return found;
}

/**
 * An SSO strategy which, as a strategy author would, grants the Role it resolved for the
 * identity: here the Role named in the input.
 */
class RoleGrantingSsoStrategy implements AuthenticationStrategy<{ email: string; roleCode: string }> {
    readonly name = 'sec_sso';
    private externalAuthenticationService: ExternalAuthenticationService;
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.connection = injector.get(TransactionalConnection);
    }

    defineInputType() {
        return gql`
            input SecSsoInput {
                email: String!
                roleCode: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: { email: string; roleCode: string }): Promise<User> {
        const user = await this.externalAuthenticationService.findAdministratorUser(
            ctx,
            this.name,
            data.email,
        );
        if (user) {
            return user;
        }
        const role = await this.connection
            .getRepository(ctx, Role)
            .findOneOrFail({ where: { code: data.roleCode } });
        return this.externalAuthenticationService.createAdministratorAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: data.email,
            identifier: data.email,
            emailAddress: data.email,
            firstName: 'Sso',
            lastName: 'Sec',
            roles: [role],
        });
    }
}

const ssoAuthenticateDocument = gql`
    mutation SecSsoAuthenticate($email: String!, $roleCode: String!) {
        authenticate(input: { sec_sso: { email: $email, roleCode: $roleCode } }) {
            ... on CurrentUser {
                channels {
                    id
                    permissions
                }
            }
            ... on ErrorResult {
                message
            }
        }
    }
`;

const FORBIDDEN = 'You are not currently authorized to perform this action';
const INSUFFICIENT = 'Active user does not have sufficient permissions';

describe('RoleAssignment security matrix (OSS-792)', () => {
    const config = testConfig();
    config.authOptions.tokenMethod = ['bearer', 'api-key'];
    config.authOptions.adminAuthenticationStrategy = [
        ...(config.authOptions.adminAuthenticationStrategy ?? []),
        new RoleGrantingSsoStrategy(),
    ];
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const adminApiUrl = `http://localhost:${config.apiOptions.port}/${config.apiOptions.adminApiPath ?? 'admin-api'}`;
    // A second, independently authenticated admin client so one actor can hold a live session
    // while another actor mutates its assignments.
    const victimClient = new SimpleGraphQLClient(config as any, adminApiUrl);
    // The roleAssignments list only shows rows the active user may grant, so state checks
    // read through a SuperAdmin client to see every row. It logs in as its own SuperAdmin
    // because logout ends every session of the User, and adminClient logs out often.
    const superClient = new SimpleGraphQLClient(config as any, adminApiUrl);

    const A = 'T_1';
    const A_TOKEN = E2E_DEFAULT_CHANNEL_TOKEN;
    type ChannelFragment = FragmentOf<typeof channelFragment>;
    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );
    let B: string;
    let B_TOKEN: string;

    const roles: Record<string, { id: string; code: string }> = {};
    const admins: Record<string, { id: string; userId: string; email: string }> = {};
    let superAdminRoleId: string;
    let roleEditorRoleId: string;
    let productId: string;
    let apiKeyA: { id: string; key: string; userId: string };
    let apiKeyB: { id: string; key: string; userId: string };
    let customer: { userId: string; email: string };

    const PASSWORD = 'test';

    async function loginAdmin(client: SimpleGraphQLClient, actor: string, channelToken = A_TOKEN) {
        await client.asUserWithCredentials(admins[actor].email, PASSWORD);
        client.setChannelToken(channelToken);
    }
    async function asSuper(channelToken = A_TOKEN) {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(channelToken);
    }
    async function as(actor: string, channelToken = A_TOKEN) {
        await loginAdmin(adminClient, actor, channelToken);
    }

    async function createRole(code: string, permissions: Permission[]) {
        const { createRole: role } = await adminClient.query(createRoleDocument, {
            input: { code, description: '', permissions },
        });
        roles[code] = role;
        return role;
    }
    async function createAdmin(name: string, assignments: Array<{ roleId: string; channelId: string }>) {
        const email = `${name}@sec.test`;
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: name,
                lastName: 'Sec',
                emailAddress: email,
                password: PASSWORD,
                roleAssignments: assignments,
            },
        });
        admins[name] = { id: createAdministrator.id, userId: createAdministrator.user.id, email };
        return admins[name];
    }
    async function assignmentsOf(userId: string) {
        const { roleAssignments } = await superClient.query(roleAssignmentsDocument, {
            options: { filter: { userId: { eq: userId } } },
        });
        return roleAssignments.items.map(a => `${a.role.code}@${a.channelId}`).sort();
    }
    type Pair = { roleId: string; channelId: string };
    async function apiKeyUserId(apiKeyId: string, channelToken = A_TOKEN) {
        superClient.setChannelToken(channelToken);
        const { apiKey } = await superClient.query(apiKeyUserDocument, { id: apiKeyId });
        superClient.setChannelToken(A_TOKEN);
        if (!apiKey) throw new Error(`API key ${apiKeyId} not found`);
        return apiKey.user.id;
    }
    const grant = (userId: string, assignments: Pair[]) =>
        adminClient.query(assignRolesToUserDocument, { input: { userId, assignments } });
    const revoke = (userId: string, assignments: Pair[]) =>
        adminClient.query(removeRolesFromUserDocument, { input: { userId, assignments } });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await asSuper();

        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'channel-b',
                token: 'channel-b-token',
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(createChannel);
        B = createChannel.id;
        B_TOKEN = createChannel.token;

        const { roles: allRoles } = await adminClient.query(rolesDocument);
        superAdminRoleId = mustFind(
            allRoles.items,
            r => r.code === SUPER_ADMIN_ROLE_CODE,
            'SuperAdmin role',
        ).id;
        roleEditorRoleId = mustFind(
            allRoles.items,
            r => r.code === ROLE_EDITOR_ROLE_CODE,
            'RoleEditor role',
        ).id;

        await createRole('R1', [Permission.ReadCatalog, Permission.UpdateCatalog]);
        await createRole('R2', [
            Permission.ReadCatalog,
            Permission.UpdateCatalog,
            Permission.CreateAdministrator,
            Permission.ReadAdministrator,
            Permission.UpdateAdministrator,
            Permission.CreateApiKey,
            Permission.ReadApiKey,
            Permission.UpdateApiKey,
        ]);
        await createRole('R3', [
            Permission.ReadRole,
            Permission.CreateRole,
            Permission.UpdateRole,
            Permission.DeleteRole,
        ]);
        await createRole('RDEL', [Permission.DeleteCatalog]);
        await createRole('RUPD', [Permission.ReadCatalog, Permission.UpdateAdministrator]);
        await createRole('RMISC', [Permission.ReadCustomer]);

        await createAdmin('auditor', [{ roleId: superAdminRoleId, channelId: A }]);
        await loginAdmin(superClient, 'auditor');
        await createAdmin('adminA', [{ roleId: roles.R2.id, channelId: A }]);
        await createAdmin('adminB', [{ roleId: roles.R2.id, channelId: B }]);
        await createAdmin('roleEditorA', [
            { roleId: roles.R3.id, channelId: A },
            { roleId: roles.R1.id, channelId: A },
        ]);
        await createAdmin('lowA', [{ roleId: roles.R1.id, channelId: A }]);
        await createAdmin('updA', [{ roleId: roles.RUPD.id, channelId: A }]);
        await createAdmin('mixed', [
            { roleId: roles.R1.id, channelId: A },
            { roleId: roles.RMISC.id, channelId: B },
        ]);

        const { products } = await adminClient.query(getProductListDocument, { options: { take: 1 } });
        productId = products.items[0].id;

        const { createCustomer } = await adminClient.query(createCustomerDocument, {
            input: { firstName: 'Cust', lastName: 'Omer', emailAddress: 'customer@sec.test' },
            password: PASSWORD,
        });
        if (!('id' in createCustomer) || !createCustomer.user) throw new Error('customer not created');
        customer = { userId: createCustomer.user.id, email: 'customer@sec.test' };

        // API keys are created by their channel admins so that ownership matches the matrix.
        await as('adminA', A_TOKEN);
        const a = await adminClient.query(createApiKeyDocument, {
            input: {
                roleAssignments: [{ roleId: roles.R1.id, channelId: A }],
                translations: [{ languageCode: LanguageCode.en, name: 'apiKeyA' }],
            },
        });
        await as('adminB', B_TOKEN);
        const b = await adminClient.query(createApiKeyDocument, {
            input: {
                roleAssignments: [{ roleId: roles.R1.id, channelId: B }],
                translations: [{ languageCode: LanguageCode.en, name: 'apiKeyB' }],
            },
        });
        await asSuper();
        const { roleAssignments: all } = await adminClient.query(roleAssignmentsDocument, {});
        const knownUserIds = new Set([...Object.values(admins).map(x => x.userId), customer.userId]);
        const apiKeyUsers = all.items.filter(x => !knownUserIds.has(x.userId) && x.role.code === 'R1');
        const aUser = mustFind(apiKeyUsers, x => x.channelId === A, 'apiKeyA user').userId;
        const bUser = mustFind(apiKeyUsers, x => x.channelId === B, 'apiKeyB user').userId;
        apiKeyA = { id: a.createApiKey.entityId, key: a.createApiKey.apiKey, userId: aUser };
        apiKeyB = { id: b.createApiKey.entityId, key: b.createApiKey.apiKey, userId: bUser };
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        const out = process.env.SEC_REPORT_PATH;
        if (out) {
            fs.writeFileSync(out, JSON.stringify(report, null, 2));
        }
        // eslint-disable-next-line no-console
        console.table(
            report.map(r => ({
                section: r.section,
                id: r.id,
                expect: r.expect,
                outcome: r.outcome,
                verdict: r.verdict,
            })),
        );
        await server.destroy();
    });

    // ------------------------------------------------------------------------------------
    describe('1. envelope on grants', () => {
        const S = '1-grants';
        beforeAll(() => as('adminA'));

        it('adminA grants R1 on B to adminB (no perms on B)', async () => {
            const r = await attempt(() =>
                grant(admins.adminB.userId, [{ roleId: roles.R1.id, channelId: B }]),
            );
            record(S, 'cross-channel grant', 'deny', r);
            // adminB holds R2 on B, which adminA may not grant, so adminA has no authority over
            // adminB and it is reported as not found
            if (!r.ok) expect(r.message).toContain('No User with the id');
        });

        it('adminA grants R2 on A to lowA (holds R2 on A)', async () => {
            const r = await attempt(() => grant(admins.lowA.userId, [{ roleId: roles.R2.id, channelId: A }]));
            record(S, 'in-envelope grant', 'allow', r);
            // restore
            await revoke(admins.lowA.userId, [{ roleId: roles.R2.id, channelId: A }]);
        });

        it('updA (UpdateAdministrator only) grants R2 to self', async () => {
            await as('updA');
            const r = await attempt(() => grant(admins.updA.userId, [{ roleId: roles.R2.id, channelId: A }]));
            record(S, 'self-escalation', 'deny', r);
            await as('adminA');
        });

        it('adminA grants role containing DeleteCatalog on A', async () => {
            const r = await attempt(() =>
                grant(admins.lowA.userId, [{ roleId: roles.RDEL.id, channelId: A }]),
            );
            record(S, 'unheld permission', 'deny', r);
        });

        it('adminA mixed valid + invalid pair is atomic', async () => {
            const before = await assignmentsOf(admins.lowA.userId);
            const r = await attempt(() =>
                grant(admins.lowA.userId, [
                    { roleId: roles.R2.id, channelId: A },
                    { roleId: roles.R1.id, channelId: B },
                ]),
            );
            const after = await assignmentsOf(admins.lowA.userId);
            record(
                S,
                'mixed pairs atomic',
                'deny',
                r,
                `unchanged=${String(JSON.stringify(before) === JSON.stringify(after))}`,
            );
            expect(after).toEqual(before);
        });

        it('adminA grants SuperAdmin on A', async () => {
            const r = await attempt(() =>
                grant(admins.lowA.userId, [{ roleId: superAdminRoleId, channelId: A }]),
            );
            record(S, 'grant SuperAdmin', 'deny', r);
        });

        it('adminA grants RoleEditor on A', async () => {
            const r = await attempt(() =>
                grant(admins.lowA.userId, [{ roleId: roleEditorRoleId, channelId: A }]),
            );
            record(S, 'grant RoleEditor', 'deny', r);
        });

        it('roleEditorA uses assignRoleToAdministrator', async () => {
            await as('roleEditorA');
            const r = await attempt(() =>
                adminClient.query(assignRoleToAdministratorDocument, {
                    administratorId: admins.lowA.id,
                    roleId: roleEditorRoleId,
                }),
            );
            record(S, 'roleEditor assigns via legacy mutation', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
            await as('adminA');
        });

        // The deprecated assignRoleToAdministrator takes no channel and grants on the active
        // one, so reaching another channel goes through its token or its administrators.
        it('adminA uses assignRoleToAdministrator on token B', async () => {
            const before = await assignmentsOf(admins.lowA.userId);
            await as('adminA', B_TOKEN);
            const r = await attempt(() =>
                adminClient.query(assignRoleToAdministratorDocument, {
                    administratorId: admins.lowA.id,
                    roleId: roles.R1.id,
                }),
            );
            record(S, 'legacy assignRoleToAdministrator on a channel without UpdateAdministrator', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
            expect(await assignmentsOf(admins.lowA.userId)).toEqual(before);
            await as('adminA');
        });

        // Allowed today: the target is resolved globally, and the grant lands on A, where
        // adminA holds R1. Master's target scoping would hide adminB (Questions d8, OSS-845).
        it('adminA uses assignRoleToAdministrator on a B-only admin', async () => {
            const r = await attempt(() =>
                adminClient.query(assignRoleToAdministratorDocument, {
                    administratorId: admins.adminB.id,
                    roleId: roles.R1.id,
                }),
            );
            const after = await assignmentsOf(admins.adminB.userId);
            record(
                S,
                'legacy assignRoleToAdministrator to a B-only admin',
                'observe',
                r,
                `after=${after.join(',')}`,
            );
            if (r.ok) {
                expect(after).toEqual([`R1@${A}`, `R2@${B}`].sort());
                await superClient.query(removeRolesFromUserDocument, {
                    input: {
                        userId: admins.adminB.userId,
                        assignments: [{ roleId: roles.R1.id, channelId: A }],
                    },
                });
            }
        });

        it('adminA createAdministrator with roleAssignments on B', async () => {
            const r = await attempt(() =>
                adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Ghost',
                        lastName: 'Admin',
                        emailAddress: 'ghost@sec.test',
                        password: PASSWORD,
                        roleAssignments: [{ roleId: roles.R1.id, channelId: B }],
                    },
                }),
            );
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: 'ghost@sec.test' } } },
            });
            record(
                S,
                'createAdministrator cross-channel',
                'deny',
                r,
                `ghost rows=${administrators.totalItems}`,
            );
            expect(administrators.totalItems).toBe(0);
        });

        it('adminA createApiKey with roleAssignments on B', async () => {
            const r = await attempt(() =>
                adminClient.query(createApiKeyDocument, {
                    input: {
                        roleAssignments: [{ roleId: roles.R2.id, channelId: B }],
                        translations: [{ languageCode: LanguageCode.en, name: 'ghost key' }],
                    },
                }),
            );
            record(S, 'createApiKey cross-channel', 'deny', r);
        });

        it('adminA createAdministrator with legacy roleIds outside its envelope', async () => {
            const r = await attempt(() =>
                adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Legacy',
                        lastName: 'Ghost',
                        emailAddress: 'legacy-ghost@sec.test',
                        password: PASSWORD,
                        roleIds: [roles.RDEL.id],
                    },
                }),
            );
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: 'legacy-ghost@sec.test' } } },
            });
            record(
                S,
                'createAdministrator(roleIds) unheld permission',
                'deny',
                r,
                `ghost rows=${administrators.totalItems}`,
            );
            expect(administrators.totalItems).toBe(0);
        });

        it('adminA createAdministrator with legacy roleIds grants on the active channel only', async () => {
            const r = await attempt(() =>
                adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Legacy',
                        lastName: 'Admin',
                        emailAddress: 'legacy-admin@sec.test',
                        password: PASSWORD,
                        roleIds: [roles.R1.id],
                    },
                }),
            );
            const userId = r.ok ? r.value.createAdministrator.user.id : undefined;
            const after = userId ? await assignmentsOf(userId) : [];
            record(S, 'createAdministrator(roleIds) in envelope', 'allow', r, `after=${after.join(',')}`);
            expect(after).toEqual([`R1@${A}`]);
            if (r.ok) {
                await superClient.query(deleteAdministratorDocument, { id: r.value.createAdministrator.id });
            }
        });

        it('adminA createApiKey with legacy roleIds outside its envelope', async () => {
            const r = await attempt(() =>
                adminClient.query(createApiKeyDocument, {
                    input: {
                        roleIds: [roles.RDEL.id],
                        translations: [{ languageCode: LanguageCode.en, name: 'legacy ghost key' }],
                    },
                }),
            );
            record(S, 'createApiKey(roleIds) unheld permission', 'deny', r);
        });

        it('adminA createApiKey with legacy roleIds grants on the active channel only', async () => {
            const r = await attempt(() =>
                adminClient.query(createApiKeyDocument, {
                    input: {
                        roleIds: [roles.R1.id],
                        translations: [{ languageCode: LanguageCode.en, name: 'legacy key' }],
                    },
                }),
            );
            const keyId = r.ok ? r.value.createApiKey.entityId : undefined;
            const after = keyId ? await assignmentsOf(await apiKeyUserId(keyId)) : [];
            record(S, 'createApiKey(roleIds) in envelope', 'allow', r, `after=${after.join(',')}`);
            expect(after).toEqual([`R1@${A}`]);
            if (keyId) await superClient.query(deleteApiKeysDocument, { ids: [keyId] });
        });

        it('adminA createApiKey with legacy roleIds on token B', async () => {
            await as('adminA', B_TOKEN);
            const r = await attempt(() =>
                adminClient.query(createApiKeyDocument, {
                    input: {
                        roleIds: [roles.R1.id],
                        translations: [{ languageCode: LanguageCode.en, name: 'legacy key on B' }],
                    },
                }),
            );
            record(S, 'createApiKey(roleIds) on a channel without CreateApiKey', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
            await as('adminA');
        });
    });

    // ------------------------------------------------------------------------------------
    describe('2. envelope on removals', () => {
        const S = '2-removals';

        it('adminA strips adminB on B', async () => {
            await as('adminA');
            const r = await attempt(() =>
                revoke(admins.adminB.userId, [{ roleId: roles.R2.id, channelId: B }]),
            );
            record(S, 'cross-channel removal', 'deny', r);
        });

        it('legacy updateApiKey(roleIds) revokes a role the caller cannot grant', async () => {
            // superadmin gives apiKeyA's user an extra role adminA does not hold
            await asSuper();
            await grant(apiKeyA.userId, [{ roleId: roles.RDEL.id, channelId: A }]);
            await as('adminA');
            const r = await attempt(() =>
                adminClient.query(updateApiKeyDocument, {
                    input: { id: apiKeyA.id, roleIds: [roles.R1.id] },
                }),
            );
            const after = await assignmentsOf(apiKeyA.userId);
            record(S, 'updateApiKey(roleIds) removal envelope', 'deny', r, `after=${after.join(',')}`);
            expect(after).toContain('RDEL@' + A);
        });

        it('removeRolesFromUser revokes a role the caller cannot grant', async () => {
            await as('adminA');
            const r = await attempt(() => revoke(apiKeyA.userId, [{ roleId: roles.RDEL.id, channelId: A }]));
            const after = await assignmentsOf(apiKeyA.userId);
            record(S, 'removeRolesFromUser removal envelope', 'deny', r, `after=${after.join(',')}`);
            await asSuper();
            await revoke(apiKeyA.userId, [{ roleId: roles.RDEL.id, channelId: A }]);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('3. role edit ordering', () => {
        // Channel A is the default channel, so R4, created there, is a shared Role owned by
        // the default channel: roleEditorA, who holds RoleEditor on A, owns it.
        const S = '3-role-edit';
        let r4: { id: string; code: string };
        let r4Deleted = false;

        afterAll(async () => {
            if (r4Deleted) return;
            await asSuper();
            await revoke(admins.lowA.userId, [{ roleId: r4.id, channelId: A }]);
            await revoke(admins.adminB.userId, [{ roleId: r4.id, channelId: B }]);
        });

        it('roleEditorA creates R4, adminA assigns it, roleEditorA widens it', async () => {
            await as('roleEditorA');
            r4 = await createRole('R4', [Permission.ReadCatalog]);
            await as('adminA');
            await grant(admins.lowA.userId, [{ roleId: r4.id, channelId: A }]);
            await as('roleEditorA');
            const r = await attempt(() =>
                adminClient.query(updateRoleDocument, {
                    input: { id: r4.id, permissions: [Permission.ReadCatalog, Permission.DeleteCatalog] },
                }),
            );
            record(S, 'widen assigned role', 'deny', r);
        });

        it('R4 assigned on B, roleEditorA (A only) widens it with a permission held on A only', async () => {
            await asSuper();
            await grant(admins.adminB.userId, [{ roleId: r4.id, channelId: B }]);
            await as('roleEditorA');
            // roleEditorA holds UpdateCatalog on A but not on B, where R4 is now held too
            const r = await attempt(() =>
                adminClient.query(updateRoleDocument, {
                    input: { id: r4.id, permissions: [Permission.ReadCatalog, Permission.UpdateCatalog] },
                }),
            );
            record(S, 'widen shared role beyond a foreign holder channel', 'deny', r);
        });

        it('R4 assigned on B, roleEditorA (A only) edits it', async () => {
            const r = await attempt(() =>
                adminClient.query(updateRoleDocument, { input: { id: r4.id, description: 'edited' } }),
            );
            record(S, 'edit shared role from its owning channel', 'allow', r);
        });

        it('roleEditorA deletes R4 (assigned on B)', async () => {
            const r = await attempt(() => adminClient.query(deleteRoleDocument, { id: r4.id }));
            record(S, 'delete shared role from its owning channel', 'allow', r);
            r4Deleted = r.ok;
            expect(await assignmentsOf(admins.adminB.userId)).toEqual([`R2@${B}`]);
        });

        it('roleEditorA creates role with SuperAdmin permission', async () => {
            const r = await attempt(() =>
                adminClient.query(createRoleDocument, {
                    input: { code: 'sneaky', description: '', permissions: [Permission.SuperAdmin] },
                }),
            );
            record(S, 'create role with SuperAdmin', 'deny', r);
        });

        it('roleEditorA edits system roles', async () => {
            const r1 = await attempt(() =>
                adminClient.query(updateRoleDocument, { input: { id: superAdminRoleId, description: 'x' } }),
            );
            const r2 = await attempt(() =>
                adminClient.query(updateRoleDocument, { input: { id: roleEditorRoleId, description: 'x' } }),
            );
            record(S, 'edit SuperAdmin role', 'deny', r1);
            record(S, 'edit RoleEditor role', 'deny', r2);
        });
    });

    // ------------------------------------------------------------------------------------
    // OSS-300: a Role created on a channel other than the default one is owned by it, and
    // may only be assigned, read and edited there. Without ownership another vendor could
    // assign the Role on their own channel and so lock its creator out of editing it.
    describe('3b. channel-owned roles', () => {
        const S = '3b-owned';
        let rb: { id: string; code: string };

        beforeAll(async () => {
            await asSuper();
            await createAdmin('roleEditorB', [
                { roleId: roleEditorRoleId, channelId: B },
                { roleId: roles.R1.id, channelId: B },
            ]);
            await createAdmin('lowB', [{ roleId: roles.R1.id, channelId: B }]);
        });

        it('roleEditorB creates RB on B', async () => {
            await as('roleEditorB', B_TOKEN);
            const r = await attempt(() => createRole('RB', [Permission.ReadCatalog]));
            record(S, 'create role on own channel', 'allow', r);
            rb = roles.RB;
            const { role } = await superClient.query(roleOwnerDocument, { id: rb.id });
            expect(role?.channel?.id).toBe(B);
        });

        it('adminB assigns RB on B', async () => {
            await as('adminB', B_TOKEN);
            const r = await attempt(() => grant(admins.lowB.userId, [{ roleId: rb.id, channelId: B }]));
            record(S, 'assign owned role on its channel', 'allow', r);
        });

        it('adminA assigns RB on A', async () => {
            await as('adminA');
            const r = await attempt(() => grant(admins.lowA.userId, [{ roleId: rb.id, channelId: A }]));
            record(S, 'assign foreign-owned role on own channel', 'deny', r);
            expect(await assignmentsOf(admins.lowA.userId)).not.toContain(`RB@${A}`);
        });

        it('a SuperAdmin assigns RB on A', async () => {
            await asSuper();
            const r = await attempt(() => grant(admins.lowA.userId, [{ roleId: rb.id, channelId: A }]));
            record(S, 'SuperAdmin assigns owned role off its channel', 'deny', r);
        });

        it('adminA reads RB', async () => {
            await as('adminA');
            const { role } = await adminClient.query(roleOwnerDocument, { id: rb.id });
            const { roles: list } = await adminClient.query(rolesDocument);
            record(
                S,
                'read foreign-owned role',
                'deny',
                role || list.items.some(x => x.id === rb.id)
                    ? { ok: true, value: role }
                    : { ok: false, message: 'hidden' },
            );
        });

        it('roleEditorA (RoleEditor on the default channel) edits and deletes RB', async () => {
            await as('roleEditorA');
            const r1 = await attempt(() =>
                adminClient.query(updateRoleDocument, { input: { id: rb.id, description: 'hijacked' } }),
            );
            const r2 = await attempt(() => adminClient.query(deleteRoleDocument, { id: rb.id }));
            record(S, 'edit foreign-owned role', 'deny', r1);
            record(S, 'delete foreign-owned role', 'deny', r2);
        });

        it('roleEditorB edits shared role R1', async () => {
            await as('roleEditorB', B_TOKEN);
            const r = await attempt(() =>
                adminClient.query(updateRoleDocument, {
                    input: { id: roles.R1.id, description: 'hijacked' },
                }),
            );
            record(S, 'edit shared role from a vendor channel', 'deny', r);
        });

        it('roleEditorB widens RB with a permission not held on B', async () => {
            const r = await attempt(() =>
                adminClient.query(updateRoleDocument, {
                    input: { id: rb.id, permissions: [Permission.ReadCatalog, Permission.ReadOrder] },
                }),
            );
            record(S, 'widen owned role beyond own permissions', 'deny', r);
        });

        it('roleEditorB edits RB', async () => {
            const r = await attempt(() =>
                adminClient.query(updateRoleDocument, { input: { id: rb.id, description: 'edited' } }),
            );
            record(S, 'edit owned role', 'allow', r);
            await asSuper();
            await revoke(admins.lowB.userId, [{ roleId: rb.id, channelId: B }]);
        });
    });

    // ------------------------------------------------------------------------------------
    // assignRolesToUser / removeRolesFromUser need authority over the target (the actor may
    // grant every assignment it holds, the rule which also decides which Administrators the
    // actor may see), and the admin permission on the Channel of every pair, not only on the
    // active Channel which @Allow checks.
    describe('3c. target authority and pair channels', () => {
        const S = '3c-authority';

        beforeAll(async () => {
            await asSuper();
            // Holds R2 (incl. UpdateAdministrator) on A, and R1's permissions but no admin
            // permissions on B
            await createAdmin('splitA', [
                { roleId: roles.R2.id, channelId: A },
                { roleId: roles.R1.id, channelId: B },
            ]);
            // Holds a Role splitA may grant, so it is in splitA's authority. An Administrator
            // holding nothing would be outside it (section 12).
            await createAdmin('emptyTarget', [{ roleId: roles.R1.id, channelId: A }]);
        });

        it('adminA strips R1 on A from mixed, an admin it cannot see', async () => {
            await as('adminA');
            // mixed holds RMISC on B, which adminA may not grant
            const r = await attempt(() =>
                revoke(admins.mixed.userId, [{ roleId: roles.R1.id, channelId: A }]),
            );
            record(S, "remove a pair from an admin outside the actor's authority", 'deny', r);
            if (!r.ok) expect(r.message).toContain('No User with the id');
            expect(await assignmentsOf(admins.mixed.userId)).toContain(`R1@${A}`);
        });

        it('adminA adds R1 on A to mixed, an admin it cannot see', async () => {
            const r = await attempt(() =>
                grant(admins.mixed.userId, [{ roleId: roles.R1.id, channelId: A }]),
            );
            record(S, "assign a pair to an admin outside the actor's authority", 'deny', r);
        });

        it('adminA reads the assignments of mixed', async () => {
            const { roleAssignments } = await adminClient.query(roleAssignmentsDocument, {
                options: { filter: { userId: { eq: admins.mixed.userId } } },
            });
            const r: Attempt = roleAssignments.totalItems
                ? { ok: true, value: roleAssignments.items }
                : { ok: false, message: 'hidden' };
            record(S, "read assignments of an admin outside the actor's authority", 'deny', r);
        });

        it('splitA grants R1 on B from token A', async () => {
            await as('splitA');
            const r = await attempt(() =>
                grant(admins.emptyTarget.userId, [{ roleId: roles.R1.id, channelId: B }]),
            );
            record(S, 'grant on a channel without UpdateAdministrator', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
            expect(await assignmentsOf(admins.emptyTarget.userId)).toEqual([`R1@${A}`]);
        });

        it('splitA creates an administrator with R1 on B from token A', async () => {
            const r = await attempt(() =>
                adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'split',
                        lastName: 'Sec',
                        emailAddress: 'split-created@sec.test',
                        password: PASSWORD,
                        roleAssignments: [{ roleId: roles.R1.id, channelId: B }],
                    },
                }),
            );
            record(S, 'create with a pair on a channel without CreateAdministrator', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
        });

        it('splitA grants R2 on A', async () => {
            const r = await attempt(() =>
                grant(admins.emptyTarget.userId, [{ roleId: roles.R2.id, channelId: A }]),
            );
            record(S, 'grant on the active channel with UpdateAdministrator', 'allow', r);
            await revoke(admins.emptyTarget.userId, [{ roleId: roles.R2.id, channelId: A }]);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('4. target-class widening', () => {
        const S = '4-target';
        let customerShopToken: string;

        it('adminA assigns R1 on A to a customer user', async () => {
            shopClient.setChannelToken(A_TOKEN);
            await shopClient.asUserWithCredentials(customer.email, PASSWORD);
            shopClient.setChannelToken(A_TOKEN);
            customerShopToken = shopClient.getAuthToken();
            const { me } = await shopClient.query(shopMeDocument);
            expect(me?.id).toBe(customer.userId);

            await as('adminA');
            const r = await attempt(() => grant(customer.userId, [{ roleId: roles.R1.id, channelId: A }]));
            record(S, 'assign role to customer user', 'deny', r);
            if (!r.ok) expect(r.message).toContain('No User with the id');
        });

        it('customer shop token replayed on Admin API', async () => {
            const spoof = new SimpleGraphQLClient(config as any, adminApiUrl);
            spoof.setAuthToken(customerShopToken);
            spoof.setChannelToken(A_TOKEN);
            const read = await attempt(() => spoof.query(getProductListDocument, { options: { take: 1 } }));
            const write = await attempt(() =>
                spoof.query(updateProductDocument, { input: { id: productId, enabled: true } }),
            );
            record(S, 'shop token → admin products', 'deny', read);
            record(S, 'shop token → admin updateProduct', 'deny', write);
        });

        it('customer cannot login/me on Admin API', async () => {
            const spoof = new SimpleGraphQLClient(config as any, adminApiUrl);
            spoof.setAuthToken(customerShopToken);
            spoof.setChannelToken(A_TOKEN);
            const me = await attempt(() => spoof.query(MeDocument));
            record(S, 'shop token → admin me', 'deny', me);
            const login = await attempt(async () => {
                const fresh = new SimpleGraphQLClient(config as any, adminApiUrl);
                fresh.setChannelToken(A_TOKEN);
                const res = await fresh.query(adminLoginDocument, {
                    username: customer.email,
                    password: PASSWORD,
                });
                if (res.login.__typename !== 'CurrentUser')
                    throw new Error(`login rejected: ${res.login.__typename}`);
                return res.login;
            });
            record(S, 'customer admin login', 'deny', login);
        });

        it('adminA sees apiKeyB user in roleAssignments', async () => {
            await as('adminA');
            const { roleAssignments } = await adminClient.query(roleAssignmentsDocument, {
                options: { filter: { userId: { eq: apiKeyB.userId } } },
            });
            const pairs = roleAssignments.items.map(x => `${x.role.code}@${x.channelId}`);
            // apiKeyB holds R1 on B, which adminA may not grant: outside its authority
            record(
                S,
                'roleAssignments leaks foreign api-key user',
                'deny',
                pairs.length ? { ok: true, value: pairs } : { ok: false, message: 'hidden' },
                JSON.stringify(pairs),
            );
        });

        it('adminA adds assignment to apiKeyB user without UpdateApiKey on B', async () => {
            const r = await attempt(() => grant(apiKeyB.userId, [{ roleId: roles.R1.id, channelId: A }]));
            // Every ApiKey is also attached to the default channel, and A is the default channel,
            // so apiKeyB is reachable here, but it holds R1 on B, which adminA may not grant.
            record(S, 'assign to api-key user of B from the default channel', 'deny', r);
            if (!r.ok) expect(r.message).toContain('No User with the id');
        });

        it('adminB (UpdateApiKey on B) changes apiKeyA user roles from B', async () => {
            // apiKeyA belongs to A only, so it is not reachable on B.
            await as('adminB', B_TOKEN);
            const r = await attempt(() => grant(apiKeyA.userId, [{ roleId: roles.R1.id, channelId: B }]));
            record(S, 'assign to foreign api-key user', 'deny', r);
            if (!r.ok) expect(r.message).toContain('No User with the id');
            await as('adminA');
        });

        it('adminA (UpdateApiKey on A) changes apiKeyA user roles', async () => {
            await as('adminA');
            const r = await attempt(() => grant(apiKeyA.userId, [{ roleId: roles.R2.id, channelId: A }]));
            record(S, 'assign to own-channel api-key user', 'allow', r);
            await revoke(apiKeyA.userId, [{ roleId: roles.R2.id, channelId: A }]);
        });

        it('updA (UpdateAdministrator, no UpdateApiKey) changes apiKeyA user roles', async () => {
            await as('updA');
            const r = await attempt(() => revoke(apiKeyA.userId, [{ roleId: roles.R1.id, channelId: A }]));
            record(S, 'api-key target without UpdateApiKey', 'deny', r);
            // updA may not grant apiKeyA's R1 (it lacks UpdateCatalog), so the key's User is
            // outside its authority and reported as not found before UpdateApiKey is checked
            if (!r.ok) expect(r.message).toContain('No User with the id');
        });

        it('adminA assigns to a soft-deleted administrator', async () => {
            await asSuper();
            const del = await createAdmin('deleted', [{ roleId: roles.R1.id, channelId: A }]);
            await adminClient.query(deleteAdministratorDocument, { id: del.id });
            await as('adminA');
            const r = await attempt(() => grant(del.userId, [{ roleId: roles.R2.id, channelId: A }]));
            record(S, 'assign to deleted admin', 'deny', r);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('5. session and cache freshness', () => {
        const S = '5-session';

        it('removal is effective on the next request of a live session', async () => {
            await loginAdmin(victimClient, 'lowA');
            const warm = await attempt(() =>
                victimClient.query(updateProductDocument, { input: { id: productId, enabled: true } }),
            );
            expect(warm.ok).toBe(true);
            await asSuper();
            await revoke(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: A }]);
            const r = await attempt(() =>
                victimClient.query(updateProductDocument, { input: { id: productId, enabled: true } }),
            );
            record(S, 'stale session after removal', 'deny', r);
            await grant(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: A }]);
        });

        it('api-key session sees removal immediately', async () => {
            const keyClient = new SimpleGraphQLClient(config as any, adminApiUrl);
            (keyClient as any).headers[DEFAULT_APIKEY_HEADER_KEY] = apiKeyA.key;
            keyClient.setChannelToken(A_TOKEN);
            const warm = await attempt(() =>
                keyClient.query(getProductListDocument, { options: { take: 1 } }),
            );
            if (!warm.ok) {
                record(S, 'api-key warm-up', 'allow', warm);
            }
            await asSuper();
            await revoke(apiKeyA.userId, [{ roleId: roles.R1.id, channelId: A }]);
            const r = await attempt(() => keyClient.query(getProductListDocument, { options: { take: 1 } }));
            record(S, 'api-key stale after removal', 'deny', r);
            await grant(apiKeyA.userId, [{ roleId: roles.R1.id, channelId: A }]);
        });

        it('channel switch mid-session then removal', async () => {
            await loginAdmin(victimClient, 'lowA');
            victimClient.setChannelToken(B_TOKEN);
            await attempt(() => victimClient.query(getProductListDocument, { options: { take: 1 } }));
            victimClient.setChannelToken(A_TOKEN);
            await asSuper();
            await revoke(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: A }]);
            const r = await attempt(() =>
                victimClient.query(getProductListDocument, { options: { take: 1 } }),
            );
            record(S, 'stale after channel switch', 'deny', r);
            await grant(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: A }]);
        });

        it('new grant visible without re-login', async () => {
            await loginAdmin(victimClient, 'lowA');
            const before = await attempt(() => victimClient.query(getAdministratorsDocument, {}));
            expect(before.ok).toBe(false);
            await asSuper();
            await grant(admins.lowA.userId, [{ roleId: roles.R2.id, channelId: A }]);
            const r = await attempt(() => victimClient.query(getAdministratorsDocument, {}));
            record(S, 'new grant live', 'allow', r);
            await revoke(admins.lowA.userId, [{ roleId: roles.R2.id, channelId: A }]);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('6. channel resolution', () => {
        const S = '6-channel';

        it('adminA on channel B', async () => {
            await as('adminA', B_TOKEN);
            const r1 = await attempt(() => adminClient.query(getAdministratorsDocument, {}));
            const r2 = await attempt(() =>
                adminClient.query(getProductListDocument, { options: { take: 1 } }),
            );
            record(S, 'adminA administrators on B', 'deny', r1);
            record(S, 'adminA products on B', 'deny', r2);
        });

        it('lowA on channel B', async () => {
            await as('lowA', B_TOKEN);
            const r = await attempt(() =>
                adminClient.query(getProductListDocument, { options: { take: 1 } }),
            );
            record(S, 'lowA products on B', 'deny', r);
        });

        // The DefaultCustomerChannelAssignmentStrategy joins the customer to B on their first
        // request there, so activeCustomer resolves because the customer is now a member. A
        // declined channel resolves them as a guest instead (customer-channel-assignment-strategy
        // e2e).
        it('customer on channel B (shop API) is auto-joined by the default strategy', async () => {
            async function isMemberOfB() {
                superClient.setChannelToken(B_TOKEN);
                const { customers } = await superClient.query(getCustomerListDocument);
                superClient.setChannelToken(A_TOKEN);
                return customers.items.some(c => c.emailAddress === customer.email);
            }
            expect(await isMemberOfB()).toBe(false);

            await shopClient.asUserWithCredentials(customer.email, PASSWORD);
            shopClient.setChannelToken(B_TOKEN);
            const r = await attempt(async () => {
                const { activeCustomer } = await shopClient.query(shopActiveCustomerDocument);
                if (!activeCustomer) throw new Error('activeCustomer is null');
                return activeCustomer;
            });
            record(
                S,
                'customer activeCustomer on B (auto-joined)',
                'allow',
                r,
                r.ok ? `activeCustomer=${JSON.stringify(r.value)}` : undefined,
            );
            expect(await isMemberOfB()).toBe(true);
            shopClient.setChannelToken(A_TOKEN);
        });

        it('mixed admin: catalog perms on A do not reach B', async () => {
            await as('mixed', B_TOKEN);
            const r = await attempt(() =>
                adminClient.query(updateProductDocument, { input: { id: productId, enabled: true } }),
            );
            record(S, 'no union across channels', 'deny', r);
        });

        it('adminA self-read of assignments', async () => {
            await as('adminA');
            const r = await attempt(async () => {
                const { activeAdministrator } = await adminClient.query(activeAdminAssignmentsDocument);
                return activeAdministrator?.user.roleAssignments.map(x => `${x.role.code}@${x.channelId}`);
            });
            record(S, 'self-read', 'observe', r, r.ok ? JSON.stringify(r.value) : undefined);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('7. data exposure', () => {
        const S = '7-exposure';

        it('shop schema does not expose assignments or hashes', async () => {
            const r = await attempt(async () => {
                // The generated types resolve `__type` to `{}`.
                const res = (await shopClient.query(shopIntrospectDocument)) as Record<
                    'user' | 'customer',
                    { fields?: Array<{ name: string }> } | null
                >;
                const userFields = (res.user?.fields ?? []).map(f => f.name);
                const customerFields = (res.customer?.fields ?? []).map(f => f.name);
                const bad = [...userFields, ...customerFields].filter(f =>
                    ['roleAssignments', 'passwordHash'].includes(f),
                );
                if (bad.length) throw new Error(`exposed: ${bad.join(',')}`);
                return { userFields };
            });
            record(
                S,
                'shop introspection',
                'allow',
                r,
                r.ok ? `User fields=${String(r.value.userFields.join(','))}` : undefined,
            );
        });

        it('shop User.roles for a customer', async () => {
            shopClient.setChannelToken(A_TOKEN);
            await shopClient.asUserWithCredentials(customer.email, PASSWORD);
            shopClient.setChannelToken(A_TOKEN);
            const r = await attempt(async () => {
                const { activeCustomer } = await shopClient.query(shopCustomerRolesDocument);
                return activeCustomer?.user?.roles.map(x => x.code);
            });
            record(S, 'shop User.roles', 'observe', r, r.ok ? `roles=${JSON.stringify(r.value)}` : undefined);
        });

        it('adminA reads B-only admins', async () => {
            await as('adminA');
            const r = await attempt(async () => {
                const { administrators } = await adminClient.query(getAdministratorsDocument, {});
                return administrators.items.map(x => x.emailAddress);
            });
            record(
                S,
                'administrators list cross-channel',
                'decide',
                r,
                r.ok ? `sees adminB=${String(r.value.includes(admins.adminB.email))}` : undefined,
            );
        });

        it('lowA reads roleAssignments', async () => {
            await as('lowA');
            const r = await attempt(() => adminClient.query(roleAssignmentsDocument, {}));
            record(S, 'lowA roleAssignments', 'deny', r);
        });

        it('lowA self-read via activeAdministrator', async () => {
            const r = await attempt(async () => {
                const { activeAdministrator } = await adminClient.query(activeAdminAssignmentsDocument);
                return activeAdministrator?.user.roleAssignments.map(x => `${x.role.code}@${x.channelId}`);
            });
            record(S, 'lowA self-read', 'observe', r, r.ok ? JSON.stringify(r.value) : undefined);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('9. input abuse', () => {
        const S = '9-input';
        beforeAll(() => as('adminA'));

        it('duplicate pairs', async () => {
            const r = await attempt(() =>
                grant(admins.lowA.userId, [
                    { roleId: roles.R2.id, channelId: A },
                    { roleId: roles.R2.id, channelId: A },
                ]),
            );
            const after = await assignmentsOf(admins.lowA.userId);
            record(S, 'duplicate pairs', 'observe', r, `after=${after.join(',')}`);
            await revoke(admins.lowA.userId, [{ roleId: roles.R2.id, channelId: A }]);
        });

        it('non-existent ids', async () => {
            const r1 = await attempt(() => grant(admins.lowA.userId, [{ roleId: 'T_9999', channelId: A }]));
            const r2 = await attempt(() =>
                grant(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: 'T_9999' }]),
            );
            const r3 = await attempt(() => grant('T_9999', [{ roleId: roles.R1.id, channelId: A }]));
            record(S, 'bad roleId', 'deny', r1);
            record(S, 'bad channelId', 'deny', r2);
            record(S, 'bad userId', 'deny', r3);
        });

        it('deleted channel', async () => {
            await asSuper();
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'channel-c',
                    token: 'channel-c-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelGuard.assertSuccess(createChannel);
            await adminClient.query(deleteChannelDocument, { id: createChannel.id });
            const r = await attempt(() =>
                grant(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: createChannel.id }]),
            );
            record(S, 'deleted channel', 'deny', r);
        });

        it('granting a held pair and revoking an unheld pair are no-ops', async () => {
            await as('adminA');
            const before = await assignmentsOf(admins.lowA.userId);
            const r1 = await attempt(() =>
                grant(admins.lowA.userId, [{ roleId: roles.R1.id, channelId: A }]),
            );
            const r2 = await attempt(() =>
                revoke(admins.lowA.userId, [{ roleId: roles.R2.id, channelId: A }]),
            );
            const after = await assignmentsOf(admins.lowA.userId);
            const unchanged = `unchanged=${String(JSON.stringify(before) === JSON.stringify(after))}`;
            record(S, 'no-op grant', 'allow', r1, unchanged);
            record(S, 'no-op revoke', 'allow', r2, unchanged);
            expect(after).toEqual(before);
        });
    });

    // ------------------------------------------------------------------------------------
    // deleteAdministrator resolves its target globally: master 3.7.3 limits it to targets the
    // actor could grant every pair of (GHSA-v85r). That row asserts the ported rule and fails
    // until the port lands (OSS-845). deleteApiKeys is channel-scoped, and every key
    // is also on the default channel, so from token A it reaches B's keys as on master.
    describe('11. deletes across channels', () => {
        const S = '11-deletes';
        type Key = { id: string; userId: string };
        const keys: Record<string, Key> = {};

        async function createKey(name: string, owner: string, channelId: string, channelToken: string) {
            await as(owner, channelToken);
            const { createApiKey } = await adminClient.query(createApiKeyDocument, {
                input: {
                    roleAssignments: [{ roleId: roles.R1.id, channelId }],
                    translations: [{ languageCode: LanguageCode.en, name }],
                },
            });
            keys[name] = {
                id: createApiKey.entityId,
                userId: await apiKeyUserId(createApiKey.entityId, channelToken),
            };
        }
        const deleteAdmin = (id: string) => adminClient.query(deleteAdministratorDocument, { id });
        const deleteKey = (id: string) => adminClient.query(deleteApiKeysDocument, { ids: [id] });

        beforeAll(async () => {
            await asSuper();
            // Holds R1's permissions, so delA has authority over an Administrator holding R1 on A.
            await createRole('RDA', [
                Permission.ReadCatalog,
                Permission.UpdateCatalog,
                Permission.ReadAdministrator,
                Permission.DeleteAdministrator,
                Permission.ReadApiKey,
                Permission.DeleteApiKey,
            ]);
            await createAdmin('delA', [{ roleId: roles.RDA.id, channelId: A }]);
            await createAdmin('targetA', [{ roleId: roles.R1.id, channelId: A }]);
            await createAdmin('targetB', [{ roleId: roles.R1.id, channelId: B }]);
            await createAdmin('targetB2', [{ roleId: roles.R1.id, channelId: B }]);
            await createKey('keyA', 'adminA', A, A_TOKEN);
            await createKey('keyB', 'adminB', B, B_TOKEN);
            await createKey('keyB2', 'adminB', B, B_TOKEN);
            await as('delA');
        });

        it('delA deletes an A admin', async () => {
            const r = await attempt(() => deleteAdmin(admins.targetA.id));
            const after = await assignmentsOf(admins.targetA.userId);
            record(S, 'deleteAdministrator same channel', 'allow', r, `rows after=${after.join(',')}`);
            expect(after).toEqual([]);
        });

        it('delA deletes a B-only admin from token A', async () => {
            const r = await attempt(() => deleteAdmin(admins.targetB.id));
            const after = await assignmentsOf(admins.targetB.userId);
            record(S, 'deleteAdministrator cross-channel', 'deny', r, `rows after=${after.join(',')}`);
            expect(after).toEqual([`R1@${B}`]);
        });

        it('delA deletes a B-only admin on token B', async () => {
            await as('delA', B_TOKEN);
            const r = await attempt(() => deleteAdmin(admins.targetB2.id));
            const after = await assignmentsOf(admins.targetB2.userId);
            record(S, 'deleteAdministrator without DeleteAdministrator on B', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
            expect(after).toEqual([`R1@${B}`]);
            await as('delA');
        });

        it('delA deletes an A key', async () => {
            const r = await attempt(() => deleteKey(keys.keyA.id));
            const after = await assignmentsOf(keys.keyA.userId);
            record(S, 'deleteApiKeys same channel', 'allow', r, `rows after=${after.join(',')}`);
            expect(after).toEqual([]);
        });

        it('delA deletes a B key from token A', async () => {
            const r = await attempt(() => deleteKey(keys.keyB.id));
            const after = await assignmentsOf(keys.keyB.userId);
            record(
                S,
                'deleteApiKeys from the default channel',
                'observe',
                r,
                `rows after=${after.join(',')}`,
            );
            expect(after).toEqual(r.ok ? [] : [`R1@${B}`]);
        });

        it('delA deletes a B key on token B', async () => {
            await as('delA', B_TOKEN);
            const r = await attempt(() => deleteKey(keys.keyB2.id));
            const after = await assignmentsOf(keys.keyB2.userId);
            record(S, 'deleteApiKeys without DeleteApiKey on B', 'deny', r);
            if (!r.ok) expect(r.message).toContain(FORBIDDEN);
            expect(after).toEqual([`R1@${B}`]);
            await as('delA');
        });
    });

    // ------------------------------------------------------------------------------------
    describe('12. unassigned administrators, SSO grants and reserved codes', () => {
        const S = '12-review';
        const ssoClient = new SimpleGraphQLClient(config as any, adminApiUrl);

        beforeAll(async () => {
            await asSuper(B_TOKEN);
            await createRole('RBOWN', [Permission.ReadCatalog, Permission.UpdateCatalog]);
            await asSuper();
            // Holds ReadAdministrator and UpdateAdministrator on every Channel
            const { channels } = await adminClient.query(channelIdsDocument);
            await createAdmin(
                'platform',
                channels.items.map(channel => ({ roleId: roles.R2.id, channelId: channel.id })),
            );
            // Suspended by channel B: all of its Roles removed
            await createAdmin('suspended', [{ roleId: roles.R1.id, channelId: B }]);
            await revoke(admins.suspended.userId, [{ roleId: roles.R1.id, channelId: B }]);
        });

        // A Role owned by B, granted by an SSO strategy, must not land on the Channel the
        // unauthenticated client names in its vendure-token header
        it('SSO login naming another Channel grants a B-owned Role on B only', async () => {
            ssoClient.setChannelToken(A_TOKEN);
            const r = await attempt(() =>
                ssoClient.query(ssoAuthenticateDocument, { email: 'sso-b@sec.test', roleCode: 'RBOWN' }),
            );
            record(S, 'SSO grant follows Role ownership', 'allow', r);
            if (r.ok) {
                const channelIds = r.value.authenticate.channels.map((c: { id: string }) => c.id);
                expect(channelIds).toEqual([B]);
            }
        });

        it('a vendor admin does not see an Administrator suspended on another Channel', async () => {
            const { administrators: seenBySuperAdmin } = await superClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: admins.suspended.email } } },
            });
            expect(seenBySuperAdmin.totalItems).toBe(1);
            await as('adminA');
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: admins.suspended.email } } },
            });
            record(
                S,
                'list unassigned admin from another Channel',
                'deny',
                administrators.totalItems ? { ok: true, value: 0 } : { ok: false, message: 'not listed' },
            );
        });

        it('a vendor admin cannot take over an Administrator suspended on another Channel', async () => {
            await as('adminA');
            const r = await attempt(() =>
                adminClient.query(updateAdministratorDocument, {
                    input: { id: admins.suspended.id, password: 'taken-over' },
                }),
            );
            record(S, 'update unassigned admin from another Channel', 'deny', r);
            if (!r.ok) expect(r.message).toContain('No Administrator with the id');
        });

        it('an Administrator holding ReadAdministrator on every Channel manages them', async () => {
            await as('platform');
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: admins.suspended.email } } },
            });
            expect(administrators.totalItems).toBe(1);
            const r = await attempt(() =>
                adminClient.query(updateAdministratorDocument, {
                    input: { id: admins.suspended.id, firstName: 'Suspended' },
                }),
            );
            record(S, 'update unassigned admin with the permission everywhere', 'allow', r);
        });

        it('a Role cannot take a system Role code', async () => {
            await as('roleEditorA');
            const created = await attempt(() => createRole(ROLE_EDITOR_ROLE_CODE, [Permission.ReadCatalog]));
            record(S, 'create Role with a system code', 'deny', created);
            if (!created.ok) expect(created.message).toContain('is reserved');
            await asSuper();
            const updated = await attempt(() =>
                adminClient.query(updateRoleDocument, {
                    input: { id: roles.R1.id, code: SUPER_ADMIN_ROLE_CODE },
                }),
            );
            record(S, 'rename Role to a system code', 'deny', updated);
            if (!updated.ok) expect(updated.message).toContain('is reserved');
        });
    });

    // ------------------------------------------------------------------------------------
    describe('2c. sole SuperAdmin (last)', () => {
        const S = '2-removals';
        it('superadmin strips the sole SuperAdmin', async () => {
            await asSuper();
            // the auditor is the second SuperAdmin; with it gone the superadmin is the only one
            await revoke(admins.auditor.userId, [{ roleId: superAdminRoleId, channelId: A }]);
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: 'superadmin' } } },
            });
            const superUserId = administrators.items[0].user.id;
            const r = await attempt(() => revoke(superUserId, [{ roleId: superAdminRoleId, channelId: A }]));
            record(S, 'sole superadmin', 'deny', r);
        });
    });

    // ------------------------------------------------------------------------------------
    describe('2b. self lockout (last)', () => {
        const S = '2-removals';
        it('adminA removes own last assignment', async () => {
            await as('adminA');
            const r = await attempt(() =>
                revoke(admins.adminA.userId, [{ roleId: roles.R2.id, channelId: A }]),
            );
            const after = await attempt(() => adminClient.query(getAdministratorsDocument, {}));
            record(S, 'self lockout', 'deny', r, `subsequent admin query ok=${String(after.ok)}`);
            expect(after.ok).toBe(true);
        });
    });

    // ------------------------------------------------------------------------------------
    // Runs after 2c, when the superadmin is the sole SuperAdmin. Each round adds one more
    // SuperAdmin, then the two holders take SuperAdmin from each other in parallel. The
    // sole-SuperAdmin guard reads the holder count before it writes, so without a lock both
    // requests can see two holders and leave none. Counted from the database, since a client
    // of either holder may have lost access.
    describe('10. concurrent SuperAdmins (last)', () => {
        const S = '10-concurrent';
        const ROUNDS = 5;
        type Holder = { client: SimpleGraphQLClient; userId: string; adminId: string; email: string };
        let survivor: Holder;
        let created = 0;

        async function superAdminHolderIds(): Promise<string[]> {
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const rows = await connection.getRepository(RoleAssignment).find({
                where: { roleId: superAdminRoleId.replace(/^T_/, '') },
            });
            const userIds = rows.map(row => String(row.userId));
            const live = await connection.getRepository(Administrator).find({
                relations: { user: true },
                where: { deletedAt: IsNull(), user: { id: In(userIds) } },
            });
            return live.map(a => `T_${String(a.user.id)}`);
        }

        async function addSuperAdmin(): Promise<Holder> {
            const name = `sa${++created}`;
            const email = `${name}@sec.test`;
            const { createAdministrator } = await survivor.client.query(createAdministratorDocument, {
                input: {
                    firstName: name,
                    lastName: 'Sec',
                    emailAddress: email,
                    password: PASSWORD,
                    roleAssignments: [{ roleId: superAdminRoleId, channelId: A }],
                },
            });
            const client = new SimpleGraphQLClient(config as any, adminApiUrl);
            await client.asUserWithCredentials(email, PASSWORD);
            client.setChannelToken(A_TOKEN);
            return { client, userId: createAdministrator.user.id, adminId: createAdministrator.id, email };
        }

        // asUserWithCredentials returns the login error result rather than throwing.
        async function loginOrThrow(client: SimpleGraphQLClient, email: string) {
            const result = await client.asUserWithCredentials(email, PASSWORD);
            if (result.errorCode) {
                throw new Error(`${String(result.errorCode)}: ${String(result.message)}`);
            }
            return result;
        }

        function survivorOf(pair: Holder[], holderIds: string[]): Holder {
            return mustFind(pair, h => holderIds.includes(h.userId), 'a surviving SuperAdmin');
        }

        beforeAll(async () => {
            await asSuper();
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: { filter: { emailAddress: { eq: 'superadmin' } } },
            });
            survivor = {
                client: adminClient,
                userId: administrators.items[0].user.id,
                adminId: administrators.items[0].id,
                email: 'superadmin',
            };
            expect(await superAdminHolderIds()).toEqual([survivor.userId]);
        });

        it('two SuperAdmins removing each other in parallel leave one', async () => {
            const outcomes: string[] = [];
            for (let round = 0; round < ROUNDS; round++) {
                const other = await addSuperAdmin();
                const pair = [survivor, other];
                const results = await Promise.all(
                    pair.map((actor, i) =>
                        attempt(() =>
                            actor.client.query(removeRolesFromUserDocument, {
                                input: {
                                    userId: pair[1 - i].userId,
                                    assignments: [{ roleId: superAdminRoleId, channelId: A }],
                                },
                            }),
                        ),
                    ),
                );
                const holders = await superAdminHolderIds();
                outcomes.push(
                    `${results.filter(r => r.ok).length} ok -> ${holders.length} left` +
                        results.map(r => (r.ok ? '' : ` [${r.message}]`)).join(''),
                );
                if (holders.length === 0) {
                    record(
                        S,
                        'parallel removeRolesFromUser',
                        'deny',
                        { ok: true, value: null },
                        outcomes.join('; '),
                    );
                }
                survivor = survivorOf(pair, holders);
            }
            record(
                S,
                'parallel removeRolesFromUser',
                'observe',
                { ok: true, value: null },
                outcomes.join('; '),
            );
        });

        it('two SuperAdmins deleting each other in parallel leave one', async () => {
            const outcomes: string[] = [];
            for (let round = 0; round < ROUNDS; round++) {
                const other = await addSuperAdmin();
                const pair = [survivor, other];
                const results = await Promise.all(
                    pair.map((actor, i) =>
                        attempt(() =>
                            actor.client.query(deleteAdministratorDocument, { id: pair[1 - i].adminId }),
                        ),
                    ),
                );
                const holders = await superAdminHolderIds();
                outcomes.push(
                    `${results.filter(r => r.ok).length} ok -> ${holders.length} left` +
                        results.map(r => (r.ok ? '' : ` [${r.message}]`)).join(''),
                );
                if (holders.length === 0) {
                    record(
                        S,
                        'parallel deleteAdministrator',
                        'deny',
                        { ok: true, value: null },
                        outcomes.join('; '),
                    );
                }
                survivor = survivorOf(pair, holders);
            }
            record(
                S,
                'parallel deleteAdministrator',
                'observe',
                { ok: true, value: null },
                outcomes.join('; '),
            );
        });

        // A SuperAdmin deleted by another while logged in: the deletion removes their rows and
        // evicts their cached sessions, so the live session holds nothing on its next request.
        describe('deleted while logged in', () => {
            let victim: Holder;

            beforeAll(async () => {
                victim = await addSuperAdmin();
                await survivor.client.query(deleteAdministratorDocument, { id: victim.adminId });
            });

            it('the next request of the live session is denied', async () => {
                const list = await attempt(() => victim.client.query(getAdministratorsDocument, {}));
                const write = await attempt(() =>
                    victim.client.query(updateProductDocument, { input: { id: productId, enabled: true } }),
                );
                record(S, 'deleted SuperAdmin: administrators', 'deny', list);
                record(S, 'deleted SuperAdmin: updateProduct', 'deny', write);
            });

            it('a stale updateAdministrator submit is denied and writes nothing', async () => {
                const r = await attempt(() =>
                    victim.client.query(updateAdministratorDocument, {
                        input: { id: victim.adminId, firstName: 'stale' },
                    }),
                );
                const stored = await server.app
                    .get(TransactionalConnection)
                    .rawConnection.getRepository(Administrator)
                    .findOneOrFail({ where: { id: victim.adminId.replace(/^T_/, '') } });
                record(
                    S,
                    'deleted SuperAdmin: stale updateAdministrator',
                    'deny',
                    r,
                    `firstName=${stored.firstName}`,
                );
                expect(stored.firstName).not.toBe('stale');
            });

            it('cannot log in again', async () => {
                const client = new SimpleGraphQLClient(config as any, adminApiUrl);
                const r = await attempt(() => loginOrThrow(client, victim.email));
                record(S, 'deleted SuperAdmin: login', 'deny', r);
            });
        });

        // SuperAdmin taken away rather than the Administrator deleted: the Administrator stays,
        // so login works, but nothing past it does.
        describe('SuperAdmin removed while logged in', () => {
            let victim: Holder;

            beforeAll(async () => {
                victim = await addSuperAdmin();
                await survivor.client.query(removeRolesFromUserDocument, {
                    input: {
                        userId: victim.userId,
                        assignments: [{ roleId: superAdminRoleId, channelId: A }],
                    },
                });
            });

            it('the next request of the live session is denied', async () => {
                const r = await attempt(() => victim.client.query(getAdministratorsDocument, {}));
                record(S, 'removed SuperAdmin: administrators', 'deny', r);
            });

            it('can log in again but holds no permissions', async () => {
                const client = new SimpleGraphQLClient(config as any, adminApiUrl);
                const r = await attempt(() => loginOrThrow(client, victim.email));
                record(S, 'removed SuperAdmin: login', 'allow', r);
                client.setChannelToken(A_TOKEN);
                const { me } = await client.query(MeDocument);
                const permissions = (me?.channels ?? []).flatMap(c => c.permissions);
                expect(permissions.filter(p => p !== Permission.Authenticated)).toEqual([]);
                const list = await attempt(() => client.query(getAdministratorsDocument, {}));
                record(S, 'removed SuperAdmin: administrators after login', 'deny', list);
            });
        });
    });
});

// ----------------------------------------------------------------------------------------
const channelIdsDocument = graphql(`
    query SecChannelIds {
        channels {
            items {
                id
            }
        }
    }
`);

const rolesDocument = graphql(`
    query SecRoles {
        roles {
            items {
                id
                code
            }
        }
    }
`);

const roleOwnerDocument = graphql(`
    query SecRoleOwner($id: ID!) {
        role(id: $id) {
            id
            code
            channel {
                id
            }
        }
    }
`);

const roleAssignmentsDocument = graphql(`
    query SecRoleAssignments($options: RoleAssignmentListOptions) {
        roleAssignments(options: $options) {
            totalItems
            items {
                id
                userId
                channelId
                role {
                    code
                }
            }
        }
    }
`);

const assignRoleToAdministratorDocument = graphql(`
    mutation SecAssignRole($administratorId: ID!, $roleId: ID!) {
        assignRoleToAdministrator(administratorId: $administratorId, roleId: $roleId) {
            id
        }
    }
`);

const createApiKeyDocument = graphql(`
    mutation SecCreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);

const updateApiKeyDocument = graphql(`
    mutation SecUpdateApiKey($input: UpdateApiKeyInput!) {
        updateApiKey(input: $input) {
            id
        }
    }
`);

const apiKeyUserDocument = graphql(`
    query SecApiKeyUser($id: ID!) {
        apiKey(id: $id) {
            id
            user {
                id
            }
        }
    }
`);

const deleteApiKeysDocument = graphql(`
    mutation SecDeleteApiKeys($ids: [ID!]!) {
        deleteApiKeys(ids: $ids) {
            result
            message
        }
    }
`);

const deleteRoleDocument = graphql(`
    mutation SecDeleteRole($id: ID!) {
        deleteRole(id: $id) {
            result
            message
        }
    }
`);

const deleteChannelDocument = graphql(`
    mutation SecDeleteChannel($id: ID!) {
        deleteChannel(id: $id) {
            result
            message
        }
    }
`);

const activeAdminAssignmentsDocument = graphql(`
    query SecActiveAdminAssignments {
        activeAdministrator {
            id
            user {
                id
                roleAssignments {
                    channelId
                    role {
                        code
                    }
                }
            }
        }
    }
`);

const adminLoginDocument = graphql(`
    mutation SecAdminLogin($username: String!, $password: String!) {
        login(username: $username, password: $password) {
            __typename
            ... on CurrentUser {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const shopMeDocument = shopGraphql(`
    query SecShopMe {
        me {
            id
            identifier
        }
    }
`);

const shopActiveCustomerDocument = shopGraphql(`
    query SecShopActiveCustomer {
        activeCustomer {
            id
            emailAddress
        }
    }
`);

const shopCustomerRolesDocument = shopGraphql(`
    query SecShopCustomerRoles {
        activeCustomer {
            id
            user {
                id
                roles {
                    code
                }
            }
        }
    }
`);

const shopIntrospectDocument = shopGraphql(`
    query SecShopIntrospect {
        user: __type(name: "User") {
            fields {
                name
            }
        }
        customer: __type(name: "Customer") {
            fields {
                name
            }
        }
    }
`);

import { log } from '@clack/prompts';
import { ModuleResolutionKind, Project, QuoteKind, ScriptKind, ScriptTarget } from 'ts-morph';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Messages } from './core-entities';
import { FLAG_PREFIX } from './flags';
import { transformSourceFile } from './role-assignments-migration';
import { stripRoleChannelsFromGraphql } from './transforms/graphql-documents';

vi.mock('@clack/prompts', () => ({
    log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
        step: vi.fn(),
        message: vi.fn(),
    },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    intro: vi.fn(),
    outro: vi.fn(),
}));

/**
 * The parts of `@vendure/core` (v4 shape: no User.roles, no Role.channels) and TypeORM the
 * transforms look at.
 */
const VENDURE_CORE = `
export type ID = string | number;
export type DeepPartial<T> = { [P in keyof T]?: null | (T[P] extends Array<infer U> ? Array<DeepPartial<U>> : DeepPartial<T[P]>) };
export type FindOptionsRelations<T> = { [P in keyof T]?: boolean | object };
export type FindOptionsWhere<T> = { [P in keyof T]?: any };
export interface FindOneOptions<T> { where?: FindOptionsWhere<T>; relations?: FindOptionsRelations<T> | string[] }
export interface SelectQueryBuilder<T> { leftJoinAndSelect(property: string, alias: string): SelectQueryBuilder<T> }
export interface Repository<T> {
    find(options?: FindOneOptions<T>): Promise<T[]>;
    createQueryBuilder(alias: string): SelectQueryBuilder<T>;
    query(sql: string): Promise<any>;
}
export declare class VendureEntity { id: ID }
export declare class Channel extends VendureEntity { code: string }
export declare class Role extends VendureEntity { constructor(input?: DeepPartial<Role>); code: string; permissions: string[] }
export declare class User extends VendureEntity { constructor(input?: DeepPartial<User>); identifier: string }
export declare class Administrator extends VendureEntity { user: User; emailAddress: string }
export declare class Customer extends VendureEntity { user?: User; channels: Channel[] }
export declare class Product extends VendureEntity { channels: Channel[] }
export declare class RequestContext {}
export interface CreateRoleInput { code: string; description: string; permissions: string[] }
export declare class TransactionalConnection {
    getEntityOrThrow<T extends VendureEntity>(ctx: RequestContext, entity: new (...args: any[]) => T, id: ID, options?: FindOneOptions<T>): Promise<T>;
    getRepository<T>(ctx: RequestContext, entity: new (...args: any[]) => T): Repository<T>;
}
export declare class RoleService {
    create(ctx: RequestContext, input: CreateRoleInput): Promise<Role>;
    getSuperAdminRole(ctx?: RequestContext): Promise<Role>;
}
export declare class UserService { createApiKeyUser(ctx: RequestContext, identifier: string): Promise<User> }
export declare class ChannelService {
    assignToChannels<T extends VendureEntity>(ctx: RequestContext, entityType: new (...args: any[]) => T, entityId: ID, channelIds: ID[]): Promise<T>;
}
`;

const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
        strict: true,
        target: ScriptTarget.ES2020,
        moduleResolution: ModuleResolutionKind.Node10,
        jsx: 2 /* JsxEmit.React */,
    },
    manipulationSettings: { quoteKind: QuoteKind.Single, useTrailingCommas: true },
});
project.createSourceFile('/node_modules/@vendure/core/index.d.ts', VENDURE_CORE);

const PREAMBLE = `import {
    Administrator, ChannelService, Customer, DeepPartial, Product, RequestContext, Role, RoleService,
    TransactionalConnection, User, UserService,
} from '@vendure/core';
declare const ctx: RequestContext;
declare const connection: TransactionalConnection;
declare const user: User;
declare const role: Role;
`;

let fileCounter = 0;
function transform(code: string, extension: 'ts' | 'tsx' = 'ts') {
    fileCounter++;
    const sourceFile = project.createSourceFile(`/src/test-${fileCounter}.${extension}`, PREAMBLE + code, {
        scriptKind: extension === 'tsx' ? ScriptKind.TSX : ScriptKind.TS,
    });
    const result = transformSourceFile(sourceFile);
    return { ...result, sourceFile, text: sourceFile.getFullText().slice(PREAMBLE.length) };
}

function todo(message: string) {
    return `${FLAG_PREFIX} ${message}`;
}

beforeEach(() => {
    vi.mocked(log.warn).mockClear();
});

// ─── relations options ───────────────────────────────────────────────

describe('relations options', () => {
    it('removes removed relations reached through core entities', () => {
        const { text, changes, flagged } = transform(`
async function load() {
    await connection.getEntityOrThrow(ctx, Administrator, 1, {
        relations: ['user', 'user.roles', 'user.roles.channels'],
    });
    await connection.getRepository(ctx, Role).find({ relations: ['channels'] });
    await connection.getRepository(ctx, Customer).find({ relations: { user: { roles: true }, channels: true } });
}
`);
        expect(changes).toBe(4);
        expect(flagged).toBe(0);
        expect(text).toContain(`relations: ['user'],`);
        expect(text).toContain(`find({ relations: [] })`);
        expect(text).toContain(`relations: { user: { }, channels: true }`);
    });

    it('keeps channels on entities that still have them', () => {
        const { text, changes } = transform(`
connection.getRepository(ctx, Product).find({ relations: ['channels'] });
connection.getRepository(ctx, Customer).find({ relations: ['channels', 'user'] });
`);
        expect(changes).toBe(0);
        expect(text).toContain(`relations: ['channels']`);
        expect(text).toContain(`relations: ['channels', 'user']`);
    });

    it('flags relations whose entity cannot be resolved', () => {
        const { text, changes, flagged } = transform(`
declare const repo: any;
repo.find({ relations: ['user.roles', 'channels'] });
`);
        expect(changes).toBe(0);
        expect(flagged).toBe(1);
        expect(text).toContain(todo(Messages.UnresolvedRelation));
        expect(text).toContain(`relations: ['user.roles', 'channels']`);
    });

    it('flags removed relations in where options', () => {
        const { text, flagged } = transform(`
connection.getRepository(ctx, Administrator).find({
    where: { user: { roles: { code: 'x' } } },
});
`);
        expect(flagged).toBe(1);
        expect(text).toContain(`    ${todo(Messages.UserRoles)}\n    where:`);
    });
});

// ─── reads and writes ────────────────────────────────────────────────

describe('removed relation reads and writes', () => {
    it('flags reads of User.roles and Role.channels', () => {
        const { text, flagged } = transform(`
declare const admin: Administrator;
const codes = admin.user.roles.map(r => r.code);
function channelsOf(r?: Role) {
    return r?.channels;
}
`);
        expect(flagged).toBe(2);
        expect(text).toContain(`${todo(Messages.UserRoles)}\nconst codes`);
        expect(text).toContain(`    ${todo(Messages.RoleChannels)}\n    return r?.channels;`);
    });

    it('flags destructuring and object literals that build a User or Role', () => {
        const { text, flagged } = transform(`
const { roles, identifier } = user;
const created = new Role({ code: 'x', channels: [] });
const partial: DeepPartial<User> = { identifier: 'a', roles: [] };
`);
        expect(flagged).toBe(3);
        expect(text).toContain(`${todo(Messages.UserRoles)}\nconst { roles, identifier }`);
        expect(text).toContain(`${todo(Messages.RoleChannels)}\nconst created`);
        expect(text).toContain(`${todo(Messages.UserRoles)}\nconst partial`);
    });

    it('leaves a project-defined User class alone', () => {
        const { flagged } = transform(`
class Team { roles: string[] = [] }
declare const team: Team;
team.roles.push('x');
`);
        expect(flagged).toBe(0);
    });

    it('does not add the same flag twice', () => {
        const first = transform(`const r = user.roles;\n`);
        expect(first.flagged).toBe(1);
        expect(transformSourceFile(first.sourceFile).flagged).toBe(0);
        expect(first.sourceFile.getFullText().split(FLAG_PREFIX).length).toBe(2);
    });

    it('puts the comment above JSX, not inside it', () => {
        const { text } = transform(
            `
const el = (
    <ul>
        {user.roles.map(r => <li>{r.code}</li>)}
    </ul>
);
`,
            'tsx',
        );
        expect(text).toContain(`const el = (\n    ${todo(Messages.UserRoles)}\n    <ul>`);
    });
});

// ─── removed APIs ────────────────────────────────────────────────────

describe('removed APIs', () => {
    it('flags channelIds in a CreateRoleInput', () => {
        const { text, flagged } = transform(`
declare const roleService: RoleService;
roleService.create(ctx, { code: 'x', description: '', permissions: [], channelIds: [1] });
`);
        expect(flagged).toBe(1);
        expect(text).toContain(todo(Messages.RoleChannelIds));
    });

    it('flags removed and changed service methods', () => {
        const { text, flagged } = transform(`
declare const roleService: RoleService;
declare const userService: UserService;
declare const channelService: ChannelService;
async function run() {
    await (roleService as any).getChannelsForRole(ctx, 1);
    await roleService.getChannelsForRole(ctx, 1);
    await userService.createApiKeyUser(ctx, [], 'key');
    await channelService.assignToChannels(ctx, Role, 1, [2]);
    await channelService.assignToChannels(ctx, Product, 1, [2]);
}
`);
        expect(flagged).toBe(3);
        expect(text).toContain(todo(Messages.GetChannelsForRole));
        expect(text).toContain(todo(Messages.CreateApiKeyUser));
        expect(text).toContain(todo(Messages.RoleChannelAware));
    });

    it('flags joins and raw SQL on the removed tables', () => {
        const { text, flagged } = transform(`
const repo = connection.getRepository(ctx, User);
repo.createQueryBuilder('user').leftJoinAndSelect('user.roles', 'roles');
repo.createQueryBuilder('user').leftJoinAndSelect('product.channels', 'channels');
repo.query('SELECT * FROM user_roles_role');
`);
        expect(flagged).toBe(2);
        expect(text).toContain(todo(Messages.UnresolvedJoin));
        expect(text).toContain(todo(Messages.RemovedJoin));
    });
});

// ─── GraphQL ─────────────────────────────────────────────────────────

describe('stripRoleChannelsFromGraphql', () => {
    it('removes channels from Role selections only', () => {
        const result = stripRoleChannelsFromGraphql(`
query GetRoles {
    roles {
        items {
            id
            channels {
                id
            }
        }
    }
    activeChannel { id }
    me { channels { id } }
}

fragment AdminRoles on Administrator {
    user { roles { code channels { id } } }
}
`);
        expect(result?.changes).toBe(2);
        expect(result?.output).toBe(`
query GetRoles {
    roles {
        items {
            id
        }
    }
    activeChannel { id }
    me { channels { id } }
}

fragment AdminRoles on Administrator {
    user { roles { code } }
}
`);
    });

    it('handles fragments and inline fragments on Role', () => {
        const result = stripRoleChannelsFromGraphql(
            `fragment R on Role { id channels { id } } query { node { ... on Role { code, channels { id } } } }`,
        );
        expect(result?.output).toBe(`fragment R on Role { id } query { node { ... on Role { code } } }`);
    });

    it('removes inline channelIds and variables only it used', () => {
        const result = stripRoleChannelsFromGraphql(`
mutation CreateRole($code: String!, $channelIds: [ID!]) {
    createRole(input: { code: $code, permissions: [], channelIds: $channelIds }) {
        id
        channels { id }
    }
}
`);
        expect(result?.changes).toBe(3);
        expect(result?.output).toBe(`
mutation CreateRole($code: String!) {
    createRole(input: { code: $code, permissions: [] }) {
        id
    }
}
`);
        expect(result?.notes.map(note => note.message)).toEqual([Messages.RoleChannelIds]);
    });

    it('leaves a selection with only channels in it, with a note', () => {
        const result = stripRoleChannelsFromGraphql(`query { role(id: 1) { channels { id } } }`);
        expect(result?.changes).toBe(0);
        expect(result?.notes).toHaveLength(1);
    });

    it('returns undefined for text that is not GraphQL', () => {
        expect(stripRoleChannelsFromGraphql('not { graphql')).toBeUndefined();
    });
});

describe('GraphQL templates', () => {
    it('strips gql templates and graphql() calls, keeping substitutions', () => {
        const { text, changes } = transform(`
declare function gql(strings: TemplateStringsArray, ...values: unknown[]): unknown;
declare function graphql(source: string): unknown;
const FRAGMENT = 'fragment F on Role { id }';
const a = gql\`
    query {
        role(id: 1) {
            ...F
            channels { id }
        }
    }
    \${FRAGMENT}
\`;
const b = graphql(\`query { roles { items { id channels { id } } } }\`);
`);
        expect(changes).toBe(2);
        expect(text).toContain(
            `        role(id: 1) {\n            ...F\n        }\n    }\n    \${FRAGMENT}\n\``,
        );
        expect(text).toContain('graphql(`query { roles { items { id } } }`)');
    });
});

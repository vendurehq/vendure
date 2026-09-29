import { describe, expect, it } from 'vitest';

import { PermissionDefinition } from '../../common/permission-definition';

import { generatePermissionEnum } from './generate-permissions';

// Using require right now to force the commonjs version of GraphQL to be used
// when running vitest tests. See https://github.com/vitejs/vite/issues/7879
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildSchema } = require('graphql');
/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('generatePermissionEnum()', () => {
    const schema = () =>
        buildSchema(`
            type Query {
                permissions: [Permission!]!
            }

            enum Permission
        `);

    it('replaces the Permission placeholder with the default permissions', () => {
        const result = generatePermissionEnum(schema(), []);

        const permissionEnum = result.getType('Permission') as any;
        const values = permissionEnum.getValues().map((v: any) => v.name);
        expect(values).toContain('SuperAdmin');
        expect(values).toContain('CreateOrder');
        expect(values).toContain('Owner');
        expect(values).toContain('Public');
    });

    it('includes custom permission definitions', () => {
        const custom = new PermissionDefinition({
            name: 'Wishlist',
            description: 'Allows access to wishlists',
        });

        const result = generatePermissionEnum(schema(), [custom]);

        const permissionEnum = result.getType('Permission') as any;
        const wishlist = permissionEnum.getValues().find((v: any) => v.name === 'Wishlist');
        expect(wishlist).toBeDefined();
        expect(wishlist.description).toBe('Allows access to wishlists');
        const queryFieldType = result.getQueryType()!.getFields().permissions.type as any;
        expect(queryFieldType.ofType.ofType.ofType).toBe(permissionEnum);
    });
});

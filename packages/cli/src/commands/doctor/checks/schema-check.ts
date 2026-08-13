import { GraphQLTypesLoader } from '@nestjs/graphql';
import {
    getFinalVendureSchema,
    RuntimeVendureConfig,
    VENDURE_ADMIN_API_TYPE_PATHS,
    VENDURE_SHOP_API_TYPE_PATHS,
} from '@vendure/core';

import { CheckResult } from '../types';

/**
 * Attempts to build the Admin API and Shop API GraphQL schemas.
 * This validates that all plugin schema extensions, custom field types,
 * and SDL definitions compile correctly.
 *
 * Requires a loaded RuntimeVendureConfig from the config check (Check 3).
 */
export async function runSchemaCheck(config: RuntimeVendureConfig): Promise<CheckResult> {
    const details: string[] = [];
    let worstStatus: 'pass' | 'warn' | 'fail' = 'pass';

    // Note: GraphQLTypesLoader is cast to `any` to avoid type mismatch errors
    // when multiple @nestjs/graphql copies exist in the monorepo. This matches
    // the pattern used in the existing schema command.
    const typesLoader = new GraphQLTypesLoader() as any;

    // 1. Build Admin API schema
    try {
        await getFinalVendureSchema({
            config,
            typePaths: VENDURE_ADMIN_API_TYPE_PATHS,
            typesLoader,
            apiType: 'admin',
        } as any);
        details.push('Admin API schema validated successfully');
    } catch (e: any) {
        worstStatus = 'fail';
        const errorMessage = e instanceof Error ? e.message : String(e);
        details.push(`Admin API schema failed: ${errorMessage}`);
    }

    // 2. Build Shop API schema
    try {
        await getFinalVendureSchema({
            config,
            typePaths: VENDURE_SHOP_API_TYPE_PATHS,
            typesLoader,
            apiType: 'shop',
        } as any);
        details.push('Shop API schema validated successfully');
    } catch (e: any) {
        worstStatus = 'fail';
        const errorMessage = e instanceof Error ? e.message : String(e);
        details.push(`Shop API schema failed: ${errorMessage}`);
    }

    const message =
        worstStatus === 'pass'
            ? 'Admin and Shop API schemas validated successfully'
            : 'Schema validation failed';

    return {
        name: 'Schema',
        status: worstStatus,
        message,
        details,
    };
}

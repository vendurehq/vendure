import type { VendureConfig } from '@vendure/core';
import path from 'node:path';

import { selectTsConfigFile } from '../utilities/ast-utils';

import { findNearestTsConfig, isTypeScriptRegistered, registerTypeScript } from './register-typescript';
import { VendureConfigRef } from './vendure-config-ref';

export async function loadVendureConfigFile(
    vendureConfig: VendureConfigRef,
    providedTsConfigPath?: string,
): Promise<VendureConfig> {
    await import('dotenv/config');
    if (!isTypeScriptRegistered()) {
        // Find the nearest tsconfig to the actual VendureConfig file.
        // This is important in monorepos where each package has its own tsconfig
        // that may extend a base config with path mappings.
        const configFilePath = vendureConfig.sourceFile.getFilePath();
        const tsConfigPath =
            findNearestTsConfig(path.dirname(configFilePath)) ??
            (providedTsConfigPath
                ? path.resolve(providedTsConfigPath)
                : path.join(process.cwd(), selectTsConfigFile()));

        registerTypeScript({ tsconfigPath: tsConfigPath });
    }
    const exportedVarName = vendureConfig.getConfigObjectVariableName();
    if (!exportedVarName) {
        throw new Error('Could not find the exported variable name in the VendureConfig file');
    }
    const configModule = await import(vendureConfig.sourceFile.getFilePath());
    return configModule[exportedVarName];
}

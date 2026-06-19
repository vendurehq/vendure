import type { Rule } from 'eslint';

export type VendureRule = Rule.RuleModule;

export interface VendurePlugin {
    rules: Record<string, VendureRule>;
    configs: {
        recommended: any[];
    };
}

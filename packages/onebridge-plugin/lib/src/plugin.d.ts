import { Type } from '@nestjs/common';
import { OnebridgePluginOptions } from './types';
/**
 * ONE BRIDGE 跨境插件（计划书 §7.1）。
 * M1：实体 + 幂等建表迁移 + customFields + 权限 + 领域纯函数。
 * M2：Shop/Admin resolver、内容/验货/清关、订单聚合、Dashboard、种子、e2e。
 */
export declare class OnebridgePlugin {
    private static pluginOptions;
    static init(options?: OnebridgePluginOptions): Type<OnebridgePlugin>;
    static get options(): OnebridgePluginOptions;
}

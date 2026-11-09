/** 具名的播种步骤：name 只用于日志与失败汇总，run 抛错由调用方隔离 */
export interface NamedSeedStep<T> {
    name: string;
    run: (ctx: T) => Promise<unknown>;
}
/**
 * 按步骤隔离执行默认数据播种。
 *
 * 背景：原实现把所有步骤包在一个 try/catch 里，任何一个步骤失败（例如全局配送档案
 * 需要 SuperAdmin 权限）都会让后续步骤（含官方租户播种）全部不执行，且只留一条笼统日志。
 *
 * 现在的约定：
 * - 单步失败只记录「步骤名 + 真实错误」，继续执行后续步骤；
 * - 全部跑完后如果存在失败，再记一条汇总日志列出全部失败步骤名；
 * - 返回失败步骤名数组（空数组=全部成功），供单测与启动日志使用。
 *
 * 注意：这里是「隔离」不是「吞掉」——失败步骤一定有 error 级日志，且汇总日志里能一眼看到步骤名。
 */
export declare function runSeedSteps<T>(ctx: T, steps: NamedSeedStep<T>[]): Promise<string[]>;
export interface TenantNoOccupant {
    code: string;
    isOfficial: boolean;
}
/**
 * 查找某个 tenantNo 的现有占用者。
 *
 * 数据库上 tenantNo 只是 channel 的自定义字段，**没有唯一约束**，
 * 因此「业务租户先占了官方位」不会在写入时报错，只会静默出现两个渠道同号。
 * 官方租户播种前必须先做这个检测，冲突时跳过该号位并打 error 日志。
 */
export declare function findTenantNoOccupant(channels: Array<{
    code: string;
    customFields?: {
        tenantNo?: number;
        isOfficial?: boolean;
    } | null;
}>, tenantNo: number): TenantNoOccupant | undefined;

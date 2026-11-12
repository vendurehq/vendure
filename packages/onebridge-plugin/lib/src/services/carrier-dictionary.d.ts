/**
 * 承运商字典（B-16）：carrierCode → 展示名。
 *
 * 口径（契约冻结 §0 / CT-09）：
 * - `carrierCode` 原样返回物流插件写入的值，不做大小写/别名改写；
 * - 字典命不中时 `carrierName` 返回 null（C 端按「未知承运商」占位），
 *   `status` 仍按 logistics_track 原值返回、缺省 `unknown`，语义不改；
 * - 新增承运商只在本文件补一行，不动接口与返回形状。
 *
 * 注意：韩国段（CJ/한진/롯데/우체국）与中韩干线（SF/EMS/DHL 等）是跨境主链路，
 * 优先覆盖；国内快递补常用项。
 */
export declare const CARRIER_NAMES: Readonly<Record<string, string>>;
/**
 * 按 carrierCode 取承运商展示名。
 * 命中规则：先原样、再小写、再去掉空白/下划线后的归一化键；都不中返回 null。
 */
export declare function resolveCarrierName(carrierCode: string | null | undefined): string | null;

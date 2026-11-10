#!/usr/bin/env node
// ONE BRIDGE 跨境 Channel 种子脚本（M2，按已核实契约修订）
//
// 契约要点：
// - code 不可自定义：createTenant 内 tenantNo = nextTenantNo()，code = `t${tenantNo}`，并派生默认角色与 SSO 渠道绑定
// - tenantNo 不可硬写：官方自营预留 1-20，业务租户容量上限由服务端控制；本脚本只读取分配结果并回写配置文件
// - customDomains 是硬要求：域名解析只读 customDomains，必须与 nginx proxy_set_header Host 一致（第一版 g.joho.cn）
// - 语言/币种：显式 ko / KRW；可用币种 [KRW, CNY]；金额精度保持 2（Vendure 默认 MoneyStrategy）
// - 韩文文案：本脚本不灌任何业务文案，文案待定稿后由内容接口维护
//
// 用法:
//   node tools/seed-onebridge-channel.mjs
//   node tools/seed-onebridge-channel.mjs http://127.0.0.1:3000/admin-api
// 环境变量:
//   ONE_BRIDGE_ADMIN_USER / ONE_BRIDGE_ADMIN_PASS
//   ONE_BRIDGE_CHANNEL_NAME       default: ONE BRIDGE
//   ONE_BRIDGE_CHANNEL_TOKEN      default: onebridge-dev-token（占位，生产必须覆盖）
//   ONE_BRIDGE_CUSTOM_DOMAINS     default: g.joho.cn,onebridge.localhost（逗号分隔，可多个；
//                                 后者仅供本地联调，C 端反代 Host 用 onebridge.localhost 即可命中 KRW 渠道）
//   ONE_BRIDGE_DOMAIN             default: 取 customDomains 第一个
//   ONE_BRIDGE_CONFIG_OUT         default: tools/onebridge-channel.json（回写实际分配的 code/tenantNo/token）
// 幂等: 已存在启用 ONE BRIDGE 的渠道时只校验并打印现状，不覆盖既有数据。
//
// 本地联调（customDomains 必须与 C 端反代实际转发的 Host 一致，127.0.0.1 与 g.joho.cn 可并列）：
//   ONE_BRIDGE_CUSTOM_DOMAINS=127.0.0.1:3100,g.joho.cn ONE_BRIDGE_CHANNEL_TOKEN=onebridge-dev-token \
//     node tools/seed-onebridge-channel.mjs
// 创建完成后把回写到的 token 填进 packages/dev-server/.env 的 ONE_BRIDGE_CHANNEL_TOKEN，
// 插件才会把该租户的请求强制绑定到 KRW Channel（未填则按 ctx.channel.token 判定）。

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = process.argv[2] || process.env.ONE_BRIDGE_ADMIN_URL || 'http://127.0.0.1:3000/admin-api';
const CHANNEL_NAME = process.env.ONE_BRIDGE_CHANNEL_NAME || 'ONE BRIDGE';
const CHANNEL_TOKEN = process.env.ONE_BRIDGE_CHANNEL_TOKEN || 'onebridge-dev-token';
const CUSTOM_DOMAINS = (process.env.ONE_BRIDGE_CUSTOM_DOMAINS || 'g.joho.cn,onebridge.localhost')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const DOMAIN = process.env.ONE_BRIDGE_DOMAIN || CUSTOM_DOMAINS[0];
const LANGUAGE = 'ko';
const CURRENCY = 'KRW';
const AVAILABLE_CURRENCIES = ['KRW', 'CNY'];
const CONFIG_OUT =
    process.env.ONE_BRIDGE_CONFIG_OUT ||
    resolve(dirname(fileURLToPath(import.meta.url)), 'onebridge-channel.json');

const PLACEHOLDERS = {
    token: !process.env.ONE_BRIDGE_CHANNEL_TOKEN,
    customDomains: !process.env.ONE_BRIDGE_CUSTOM_DOMAINS,
};

const log = m => console.log('[onebridge-seed]', m);

async function adminGql(query, variables = {}, token = '', channelToken = '') {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (channelToken) headers['vendure-token'] = channelToken;
    const res = await fetch(ADMIN, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const body = await res.json().catch(() => ({ http: res.status, raw: 'parse-fail' }));
    const auth = res.headers.get('vendure-auth-token');
    if (auth && body.data) body.data.__authToken = auth;
    if (body.errors) console.error('[admin-err]', body.errors.map(e => e.message).join(' | '));
    return body;
}

async function adminLogin() {
    const attempts = [
        [process.env.ONE_BRIDGE_ADMIN_USER, process.env.ONE_BRIDGE_ADMIN_PASS],
        ['superadmin', 'superadmin'],
        ['superadmin@china.test', 'superadmin'],
    ].filter(([u, p]) => u && p);
    for (const [u, p] of attempts) {
        const r = await adminGql(
            `mutation{login(username:"${u}",password:"${p}"){... on CurrentUser{identifier}... on InvalidCredentialsError{message}}}`,
        );
        const identifier = r.data?.login?.identifier;
        if (r.data?.__authToken && identifier) return { token: r.data.__authToken, identifier };
    }
    throw new Error('Admin 登录失败，请设置 ONE_BRIDGE_ADMIN_USER / ONE_BRIDGE_ADMIN_PASS');
}

function writeConfig(payload) {
    mkdirSync(dirname(CONFIG_OUT), { recursive: true });
    writeFileSync(CONFIG_OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    log(`已回写渠道配置: ${CONFIG_OUT}`);
}

/**
 * 韩国 PG 支付桩（CT-05）：登记 korea-pg handler 并绑定到 ONE BRIDGE 渠道，幂等。
 * 不写任何真实商户号/密钥；merchantId/secretKey/callbackUrl 待 PRE-02 给值后在后台补。
 */
async function ensureKoreaPgPaymentMethod(token, channelId) {
    const found = await adminGql(
        `query{paymentMethods(options:{filter:{code:{eq:"korea-pg"}}}){items{id code}}}`,
        {},
        token,
    );
    let paymentMethodId = found.data?.paymentMethods?.items?.[0]?.id;
    if (!paymentMethodId) {
        const created = await adminGql(
            `mutation($input: CreatePaymentMethodInput!){createPaymentMethod(input:$input){id code}}`,
            {
                input: {
                    code: 'korea-pg',
                    enabled: true,
                    handler: { code: 'korea-pg', arguments: [{ name: 'mode', value: 'stub' }] },
                    translations: [
                        {
                            languageCode: 'ko',
                            // 韩文待定稿：后台支付方式名先用中性英文占位，不自造韩文
                            name: 'Korea PG (stub)',
                            description: 'Phase-1 stub: no real PG integration',
                        },
                    ],
                },
            },
            token,
        );
        if (created.errors || !created.data?.createPaymentMethod?.id) {
            throw new Error('创建 korea-pg 支付方式失败');
        }
        paymentMethodId = created.data.createPaymentMethod.id;
        log(`已登记支付方式: code=korea-pg id=${paymentMethodId}（stub，未接真实 PG）`);
    } else {
        log(`支付方式已存在: code=korea-pg id=${paymentMethodId}`);
    }
    const assigned = await adminGql(
        `mutation($input: AssignPaymentMethodsToChannelInput!){assignPaymentMethodsToChannel(input:$input){id code}}`,
        { input: { paymentMethodIds: [paymentMethodId], channelId } },
        token,
    );
    if (assigned.errors) throw new Error('将 korea-pg 绑定到渠道失败');
    log(`korea-pg 已绑定渠道 ${channelId}`);
    return paymentMethodId;
}

/**
 * 渠道税区/配送区（LV-07 前置）：没有 defaultTaxZone 的渠道无法加购（"active tax zone could not be determined"）。
 * 幂等：按名称复用 Korea 区域与 0% 税率，再写回渠道的默认税区/配送区。
 */
async function ensureChannelZones(token, channelId) {
    const countries = await adminGql(
        `query{countries(options:{filter:{code:{eq:"KR"}}}){items{id code}}}`,
        {},
        token,
    );
    const countryId = countries.data?.countries?.items?.[0]?.id;
    if (!countryId) throw new Error('未找到国家 KR，无法建立税区');

    const zones = await adminGql(`query{zones{items{id name}}}`, {}, token);
    let zoneId = (zones.data?.zones?.items ?? []).find(z => z.name === 'Korea')?.id;
    if (!zoneId) {
        const created = await adminGql(
            `mutation($input:CreateZoneInput!){createZone(input:$input){id name}}`,
            { input: { name: 'Korea', memberIds: [countryId] } },
            token,
        );
        if (created.errors || !created.data?.createZone?.id) throw new Error('创建税区 Korea 失败');
        zoneId = created.data.createZone.id;
        log(`已创建税区: Korea id=${zoneId}`);
    }

    const categories = await adminGql(`query{taxCategories{items{id name}}}`, {}, token);
    const items = categories.data?.taxCategories?.items ?? [];
    const categoryId = (items.find(c => c.name === 'Standard') ?? items[0])?.id;
    if (!categoryId) throw new Error('未找到税率分类（Standard）');

    const rates = await adminGql(`query{taxRates{items{id name}}}`, {}, token);
    const rateName = 'KR VAT 0% (stub)';
    if (!(rates.data?.taxRates?.items ?? []).some(r => r.name === rateName)) {
        const created = await adminGql(
            `mutation($input:CreateTaxRateInput!){createTaxRate(input:$input){id name value}}`,
            { input: { name: rateName, enabled: true, value: 0, categoryId, zoneId } },
            token,
        );
        if (created.errors || !created.data?.createTaxRate?.id) throw new Error('创建税率失败（桩，0%）');
        log(`已创建税率: ${rateName}`);
    }

    const updated = await adminGql(
        `mutation($input:UpdateChannelInput!){updateChannel(input:$input){
            ... on Channel { id defaultTaxZone{id name} defaultShippingZone{id name} }
            ... on ErrorResult { errorCode message }
        }}`,
        { input: { id: channelId, defaultTaxZoneId: zoneId, defaultShippingZoneId: zoneId } },
        token,
    );
    const ch = updated.data?.updateChannel;
    if (updated.errors || !ch?.id) throw new Error('写回渠道默认税区/配送区失败');
    log(`渠道默认税区/配送区: ${ch.defaultTaxZone?.name ?? '-'} / ${ch.defaultShippingZone?.name ?? '-'}`);
    return { zoneId };
}

/** 渠道配送档案（LV-07 前置）：cjk 的分箱策略要求变体归属「租户默认配送档案」，
 *  且该档案必须绑定订单使用的配送方式，否则结算时会报 "not all lines have shipping"。
 *  幂等：按 code 复用配送方式与档案。 */
async function ensureChannelShipping(token, channelToken, channelId) {
    const found = await adminGql(
        `query{shippingMethods(options:{filter:{code:{eq:"onebridge-flat"}}}){items{id code}}}`,
        {},
        token,
    );
    let methodId = found.data?.shippingMethods?.items?.[0]?.id;
    if (!methodId) {
        const created = await adminGql(
            `mutation($input:CreateShippingMethodInput!){createShippingMethod(input:$input){id code}}`,
            {
                input: {
                    code: 'onebridge-flat',
                    fulfillmentHandler: 'manual-fulfillment',
                    checker: { code: 'default-shipping-eligibility-checker', arguments: [] },
                    calculator: {
                        code: 'default-shipping-calculator',
                        arguments: [
                            { name: 'rate', value: '0' },
                            { name: 'includesTax', value: 'true' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                    translations: [{ languageCode: 'ko', name: '기본 배송', description: '스텁 배송 (LV-07)' }],
                },
            },
            token,
        );
        if (created.errors || !created.data?.createShippingMethod?.id) throw new Error('创建配送方式 onebridge-flat 失败');
        methodId = created.data.createShippingMethod.id;
        log(`已创建配送方式: onebridge-flat id=${methodId}`);
    }
    const assigned = await adminGql(
        `mutation($input:AssignShippingMethodsToChannelInput!){assignShippingMethodsToChannel(input:$input){id}}`,
        { input: { channelId, shippingMethodIds: [methodId] } },
        token,
    );
    if (assigned.errors) throw new Error('配送方式绑定渠道失败');

    const profiles = await adminGql(
        `query{shippingProfiles(options:{take:100}){items{id code isGlobal isTenantDefault}}}`,
        {},
        token,
        channelToken,
    );
    // 注意：shippingProfiles 的 options.filter 只支持 name 模糊匹配，code 需在结果里精确筛
    let profile = (profiles.data?.shippingProfiles?.items ?? []).find(p => p.code === 'onebridge-default');
    let profileId = profile?.id;
    if (profileId && profile.isGlobal) {
        // 全局档案不能设为租户默认：纠正为渠道档案
        const fixed = await adminGql(
            `mutation($input:UpdateShippingProfileInput!){updateShippingProfile(input:$input){id isGlobal}}`,
            { input: { id: profileId, isGlobal: false } },
            token,
            channelToken,
        );
        if (fixed.errors) throw new Error('纠正配送档案为渠道私有失败');
    }
    if (profileId) {
        const ensured = await adminGql(
            `mutation($input:UpdateShippingProfileInput!){updateShippingProfile(input:$input){id}}`,
            { input: { id: profileId, shippingMethodIds: [methodId] } },
            token,
            channelToken,
        );
        if (ensured.errors) throw new Error('配送档案绑定配送方式失败');
    }
    if (!profileId) {
        const created = await adminGql(
            `mutation($input:CreateShippingProfileInput!){createShippingProfile(input:$input){id code}}`,
            {
                input: {
                    name: 'ONE BRIDGE 默认配送',
                    code: 'onebridge-default',
                    enabled: true,
                    isGlobal: false,
                    shippingMethodIds: [methodId],
                },
            },
            token,
            channelToken,
        );
        if (created.errors || !created.data?.createShippingProfile?.id) {
            throw new Error(`创建默认配送档案失败: ${(created.errors ?? []).map(e => e.message).join(' | ')}`);
        }
        profileId = created.data.createShippingProfile.id;
        log(`已创建配送档案: onebridge-default id=${profileId}`);
    }
    const setDefault = await adminGql(
        `mutation($id:ID!){setTenantDefaultShippingProfile(id:$id)}`,
        { id: profileId },
        token,
        channelToken,
    );
    if (setDefault.errors || setDefault.data?.setTenantDefaultShippingProfile !== true) {
        throw new Error('设置租户默认配送档案失败');
    }
    log(`租户默认配送档案: id=${profileId}（绑定配送方式 ${methodId}）`);
}

async function main() {
    for (const [key, isPlaceholder] of Object.entries(PLACEHOLDERS)) {
        if (isPlaceholder) {
            const value = key === 'customDomains' ? CUSTOM_DOMAINS.join(',') : CHANNEL_TOKEN;
            log(`WARN 占位值待确认: ${key}=${value}`);
        }
    }

    const { token } = await adminLogin();

    const channels = await adminGql(
        `query{channels(options:{take:100}){items{id code token defaultLanguageCode defaultCurrencyCode
            availableCurrencyCodes
            customFields{onebridgeEnabled tenantNo isOfficial domain customDomains shopName}}}}`,
        {},
        token,
    );
    if (channels.errors) throw new Error('查询 Channel 失败');
    const existing = channels.data.channels.items.find(
        c => c.customFields?.onebridgeEnabled === true || c.customFields?.shopName === CHANNEL_NAME,
    );
    if (existing) {
        const domains = existing.customFields?.customDomains ?? [];
        log(`ONE BRIDGE 渠道已存在，跳过创建: code=${existing.code} token=${existing.token} tenantNo=${existing.customFields?.tenantNo}`);
        log(
            `现状: language=${existing.defaultLanguageCode} currency=${existing.defaultCurrencyCode} availableCurrencies=${(existing.availableCurrencyCodes ?? []).join(',')} customDomains=${domains.join(',')}`,
        );
        if (!domains.length) {
            log('WARN 缺少 customDomains：域名解析会返回 CHANNEL_NOT_RESOLVED，请人工补齐后再上线');
        } else if (!CUSTOM_DOMAINS.every(d => domains.includes(d))) {
            log(`WARN customDomains 与期望不一致（期望 ${CUSTOM_DOMAINS.join(',')}，实际 ${domains.join(',')}），本脚本不覆盖既有租户`);
        }
        if (!existing.availableCurrencyCodes?.includes('KRW')) {
            log('WARN 可用币种缺少 KRW：请在后台 Channel 设置中补充，或重建渠道');
        }
        writeConfig({
            code: existing.code,
            token: existing.token,
            tenantNo: existing.customFields?.tenantNo,
            customDomains: domains,
            domain: existing.customFields?.domain,
            defaultLanguageCode: existing.defaultLanguageCode,
            defaultCurrencyCode: existing.defaultCurrencyCode,
            availableCurrencyCodes: existing.availableCurrencyCodes,
            created: false,
        });
        await ensureKoreaPgPaymentMethod(token, existing.id);
        await ensureChannelZones(token, existing.id);
        await ensureChannelShipping(token, existing.token, existing.id);
        return;
    }

    const created = await adminGql(
        `mutation($input: CreateTenantInput!){createTenant(input:$input){
            id code token defaultLanguageCode defaultCurrencyCode
            customFields{onebridgeEnabled tenantNo isOfficial domain customDomains shopName}
        }}`,
        {
            input: {
                name: CHANNEL_NAME,
                token: CHANNEL_TOKEN,
                defaultLanguageCode: LANGUAGE,
                currencyCode: CURRENCY,
                customDomains: CUSTOM_DOMAINS,
                domain: DOMAIN,
                extraCustomFields: { onebridgeEnabled: true },
            },
        },
        token,
    );
    const result = created.data?.createTenant;
    if (result?.__typename === 'LanguageNotAvailableError' || result?.languageCode) {
        throw new Error(`语言 ${LANGUAGE} 未在 GlobalSettings 启用，请先启用韩语后重跑: ${result.message}`);
    }
    if (created.errors || !result?.id) throw new Error('创建租户（Channel）失败');
    log(`已创建渠道: code=${result.code} token=${result.token} tenantNo=${result.customFields?.tenantNo}（code/tenantNo 由服务端分配）`);

    if (!result.customFields?.customDomains?.length) {
        throw new Error('创建成功但缺少 customDomains，域名解析会 CHANNEL_NOT_RESOLVED，请立即人工核查');
    }

    const updated = await adminGql(
        `mutation($input: UpdateChannelInput!){updateChannel(input:$input){
            ... on Channel { id code defaultLanguageCode defaultCurrencyCode availableCurrencyCodes customFields{customDomains tenantNo} }
            ... on LanguageNotAvailableError { errorCode message languageCode }
            ... on ErrorResult { errorCode message }
        }}`,
        {
            input: {
                id: result.id,
                availableCurrencyCodes: AVAILABLE_CURRENCIES,
            },
        },
        token,
    );
    const updatedChannel = updated.data?.updateChannel;
    if (updated.errors || !updatedChannel?.id) throw new Error('设置可用币种失败');

    const config = {
        code: result.code,
        token: result.token,
        tenantNo: result.customFields?.tenantNo,
        customDomains: result.customFields.customDomains,
        domain: result.customFields?.domain,
        defaultLanguageCode: result.defaultLanguageCode,
        defaultCurrencyCode: result.defaultCurrencyCode,
        availableCurrencyCodes: updatedChannel.availableCurrencyCodes,
        created: true,
    };
    writeConfig(config);
    log(`可用币种: ${updatedChannel.availableCurrencyCodes.join(',')}；金额精度保持 Vendure 默认 2`);
    await ensureKoreaPgPaymentMethod(token, result.id);
    await ensureChannelZones(token, result.id);
    await ensureChannelShipping(token, result.token, result.id);
    log('业务频道/内容文案未灌入：韩文待定稿后由内容接口维护，避免自造韩文。');
}

main().catch(e => {
    console.error('[onebridge-seed] FAILED:', e.message);
    process.exit(1);
});

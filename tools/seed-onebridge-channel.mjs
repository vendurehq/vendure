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
//   ONE_BRIDGE_CUSTOM_DOMAINS     default: g.joho.cn（逗号分隔，可多个）
//   ONE_BRIDGE_DOMAIN             default: 取 customDomains 第一个
//   ONE_BRIDGE_CONFIG_OUT         default: tools/onebridge-channel.json（回写实际分配的 code/tenantNo/token）
// 幂等: 已存在启用 ONE BRIDGE 的渠道时只校验并打印现状，不覆盖既有数据。

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = process.argv[2] || process.env.ONE_BRIDGE_ADMIN_URL || 'http://127.0.0.1:3000/admin-api';
const CHANNEL_NAME = process.env.ONE_BRIDGE_CHANNEL_NAME || 'ONE BRIDGE';
const CHANNEL_TOKEN = process.env.ONE_BRIDGE_CHANNEL_TOKEN || 'onebridge-dev-token';
const CUSTOM_DOMAINS = (process.env.ONE_BRIDGE_CUSTOM_DOMAINS || 'g.joho.cn')
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
    log('业务频道/内容文案未灌入：韩文待定稿后由内容接口维护，避免自造韩文。');
}

main().catch(e => {
    console.error('[onebridge-seed] FAILED:', e.message);
    process.exit(1);
});

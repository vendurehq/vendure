/**
 * 存量渠道兜底配置修复（B-01 / B-02）。
 *
 * 背景：修复前新建的渠道（如跨境 t25）没有继承税区/配送区，也没绑配送方式/支付方式/
 * 配送档案，导致订单卡在 `not all lines have shipping`、价格字段为 null。
 * `createChannel` 已在代码层兜底（ChannelProvisioningService），本脚本用于**存量渠道**：
 *
 *   1) 缺税区/配送区 → 继承默认渠道；
 *   2) 补绑配送方式（默认 courier-delivery）；
 *   3) 补绑支付方式（默认 cash-on-delivery）；
 *   4) 无租户默认配送档案 → 创建并设为默认（methodConfigs mode=mail）；
 *   5) 可选：把渠道内商品变体显式绑定到该档案。
 *
 * 幂等：已满足的步骤全部跳过，可重复执行。
 *
 * 用法（默认只读打印计划；加 --apply 才写入）：
 *   API_URL=https://e.joho.cn ADMIN_USERNAME=superadmin ADMIN_PASSWORD=*** \
 *   node tools/provision-onebridge-channel.mjs --channel t25
 *   node tools/provision-onebridge-channel.mjs --channel t25 --apply
 *
 * 环境变量：
 *   API_URL                 默认 http://127.0.0.1:3100
 *   DEFAULT_CHANNEL_TOKEN   默认 __default_channel__（Vendure 默认渠道 token）
 *   SHIPPING_CODES          逗号分隔，默认 courier-delivery
 *   PAYMENT_CODES           逗号分隔，默认 cash-on-delivery
 *   ASSIGN_VARIANTS         1=把渠道内变体显式绑定默认档案（默认 1）
 */

const API_BASE = process.env.API_URL ?? 'http://127.0.0.1:3100';
const ADMIN_URL = `${API_BASE}/admin-api`;
const DEFAULT_TOKEN = process.env.DEFAULT_CHANNEL_TOKEN ?? '__default_channel__';
const SHIPPING_CODES = (process.env.SHIPPING_CODES ?? 'courier-delivery')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const PAYMENT_CODES = (process.env.PAYMENT_CODES ?? 'cash-on-delivery')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const ASSIGN_VARIANTS = (process.env.ASSIGN_VARIANTS ?? '1') !== '0';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const channelArgIndex = argv.indexOf('--channel');
const TARGET_CHANNEL = channelArgIndex >= 0 ? argv[channelArgIndex + 1] : process.env.TARGET_CHANNEL;

let adminToken = null;
let currentToken = DEFAULT_TOKEN;

async function gql(query, variables) {
    const res = await fetch(ADMIN_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'vendure-token': currentToken,
            ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (json.errors?.length) {
        throw new Error(json.errors.map(e => e.message).join(' | '));
    }
    return json.data;
}

function log(step, message) {
    console.log(`[${step}] ${message}`);
}

function plan(message) {
    console.log(`${APPLY ? '[apply]' : '[dry-run]'} ${message}`);
}

async function login() {
    const res = await fetch(ADMIN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'vendure-token': DEFAULT_TOKEN },
        body: JSON.stringify({
            query: `mutation($u: String!, $p: String!) {
                login(username: $u, password: $p) {
                    ... on CurrentUser { id identifier }
                    ... on ErrorResult { errorCode message }
                }
            }`,
            variables: {
                u: process.env.ADMIN_USERNAME ?? 'superadmin',
                p: process.env.ADMIN_PASSWORD ?? 'superadmin',
            },
        }),
    });
    const body = await res.json();
    if (body.errors?.length || !body.data?.login?.id) {
        throw new Error(`admin 登录失败: ${JSON.stringify(body.errors ?? body.data)}`);
    }
    const token =
        res.headers.get('vendure-auth-token') ??
        /vendure-auth-token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    if (!token) throw new Error('admin token 获取失败');
    adminToken = decodeURIComponent(token);
    log('login', 'admin ok');
}

async function resolveTargetChannel() {
    const data = await gql(`query { activeChannel { id code defaultTaxZone { id } defaultShippingZone { id } } }`);
    const def = data.activeChannel;
    const channels = await gql(`query { channels(options: { take: 500 }) { items { id code token defaultTaxZone { id } defaultShippingZone { id } } } }`);
    const target = TARGET_CHANNEL
        ? channels.channels.items.find(c => c.code === TARGET_CHANNEL)
        : null;
    if (!target) {
        throw new Error(
            `未找到渠道 ${TARGET_CHANNEL ?? '(未指定 --channel)'}；可用：${channels.channels.items
                .map(c => c.code)
                .join(',')}`,
        );
    }
    return { def, target };
}

async function ensureZones(def, target) {
    const patch = {};
    if (!target.defaultTaxZone && def.defaultTaxZone) patch.defaultTaxZoneId = def.defaultTaxZone.id;
    if (!target.defaultShippingZone && def.defaultShippingZone) patch.defaultShippingZoneId = def.defaultShippingZone.id;
    if (Object.keys(patch).length === 0) {
        log('zones', `已具备税区 ${target.defaultTaxZone?.id ?? '-'} / 配送区 ${target.defaultShippingZone?.id ?? '-'}`);
        return;
    }
    plan(`updateChannel(${target.code}) 补 ${JSON.stringify(patch)}（继承默认渠道）`);
    if (APPLY) {
        await gql(
            `mutation($input: UpdateChannelInput!) {
                updateChannel(input: $input) { ... on Channel { id defaultTaxZone { id } defaultShippingZone { id } } ... on ErrorResult { errorCode message } }
            }`,
            { input: { id: target.id, ...patch } },
        );
        log('zones', '已补税区/配送区');
    }
}

async function channelMethodCodes() {
    const data = await gql(`query { shippingMethods(options: { take: 500 }) { items { id code } } paymentMethods(options: { take: 500 }) { items { id code } } }`);
    return {
        shipping: data.shippingMethods.items,
        payment: data.paymentMethods.items,
    };
}

async function ensureMethods(def, target) {
    // 在目标渠道视角下查（渠道隔离），缺的从默认渠道找 id 后绑定
    currentToken = target.token;
    const inChannel = await channelMethodCodes();

    const missingShippingCodes = SHIPPING_CODES.filter(c => !inChannel.shipping.some(m => m.code === c));
    const missingPaymentCodes = PAYMENT_CODES.filter(c => !inChannel.payment.some(m => m.code === c));

    if (missingShippingCodes.length === 0 && missingPaymentCodes.length === 0) {
        log('methods', '配送方式/支付方式均已绑定');
        return;
    }

    currentToken = DEFAULT_TOKEN;
    const global = await channelMethodCodes();

    if (missingShippingCodes.length > 0) {
        const ids = global.shipping.filter(m => missingShippingCodes.includes(m.code)).map(m => m.id);
        const notFound = missingShippingCodes.filter(c => !global.shipping.some(m => m.code === c));
        if (notFound.length) log('methods', `默认渠道也不存在配送方式：${notFound.join(',')}（跳过）`);
        if (ids.length) {
            plan(`assignShippingMethodsToChannel(${target.code}, ${ids.join(',')})`);
            if (APPLY) {
                await gql(
                    `mutation($input: AssignShippingMethodsToChannelInput!) {
                        assignShippingMethodsToChannel(input: $input) { id code }
                    }`,
                    { input: { channelId: target.id, shippingMethodIds: ids } },
                );
                log('methods', `已绑定配送方式 ${ids.length} 个`);
            }
        }
    }

    if (missingPaymentCodes.length > 0) {
        const ids = global.payment.filter(m => missingPaymentCodes.includes(m.code)).map(m => m.id);
        const notFound = missingPaymentCodes.filter(c => !global.payment.some(m => m.code === c));
        if (notFound.length) log('methods', `默认渠道也不存在支付方式：${notFound.join(',')}（跳过）`);
        if (ids.length) {
            plan(`assignPaymentMethodsToChannel(${target.code}, ${ids.join(',')})`);
            if (APPLY) {
                await gql(
                    `mutation($input: AssignPaymentMethodsToChannelInput!) {
                        assignPaymentMethodsToChannel(input: $input) { id code }
                    }`,
                    { input: { channelId: target.id, paymentMethodIds: ids } },
                );
                log('methods', `已绑定支付方式 ${ids.length} 个`);
            }
        }
    }
    currentToken = target.token;
}

/** korea-pg 桩的安全基线：未接入真实 PG 时 enabled=false + 名称标 STUB（B-04） */
const KOREA_PG_STUB_NAME = '韩国PG（STUB · 未接入）';

async function ensureKoreaPg(target) {
    if ((process.env.SETUP_KOREA_PG ?? '1') === '0') {
        log('korea-pg', 'SETUP_KOREA_PG=0，跳过');
        return;
    }
    const wantEnabled = process.env.KOREA_PG_ENABLED === '1';
    currentToken = DEFAULT_TOKEN;
    const data = await gql(`query { paymentMethods(options: { take: 500 }) { items { id code enabled translations { languageCode name } } } }`);
    const existing = data.paymentMethods.items.find(m => m.code === 'korea-pg');
    let id = existing?.id;
    if (!existing) {
        plan(`createPaymentMethod(korea-pg, enabled=${wantEnabled}, name="${KOREA_PG_STUB_NAME}", mode=stub)`);
        if (APPLY) {
            const created = await gql(
                `mutation($input: CreatePaymentMethodInput!) { createPaymentMethod(input: $input) { id code enabled } }`,
                {
                    input: {
                        code: 'korea-pg',
                        enabled: wantEnabled,
                        translations: [{ languageCode: 'zh_Hans', name: KOREA_PG_STUB_NAME }],
                        handler: { code: 'korea-pg', arguments: [{ name: 'mode', value: 'stub' }] },
                    },
                },
            );
            id = created.createPaymentMethod.id;
            log('korea-pg', `已创建 ${id}（enabled=${wantEnabled}）`);
        }
    } else if (existing.enabled !== wantEnabled) {
        plan(`updatePaymentMethod(korea-pg) enabled ${existing.enabled} → ${wantEnabled}`);
        if (APPLY) {
            await gql(
                `mutation($input: UpdatePaymentMethodInput!) { updatePaymentMethod(input: $input) { id enabled } }`,
                {
                    input: {
                        id: existing.id,
                        enabled: wantEnabled,
                        translations: [{ languageCode: 'zh_Hans', name: KOREA_PG_STUB_NAME }],
                    },
                },
            );
            log('korea-pg', `已调整 enabled=${wantEnabled}`);
        }
    } else {
        log('korea-pg', `已存在（enabled=${existing.enabled}）`);
    }

    // 绑定到目标渠道（未绑则绑；已绑不动）
    currentToken = target.token;
    const inChannel = await gql(`query { paymentMethods(options: { take: 500 }) { items { id code } } }`);
    if (!inChannel.paymentMethods.items.some(m => m.code === 'korea-pg')) {
        if (!id) {
            log('korea-pg', 'dry-run 未创建方式，跳过绑定');
            return;
        }
        plan(`assignPaymentMethodsToChannel(${target.code}, korea-pg)`);
        if (APPLY) {
            await gql(
                `mutation($input: AssignPaymentMethodsToChannelInput!) { assignPaymentMethodsToChannel(input: $input) { id code } }`,
                { input: { channelId: target.id, paymentMethodIds: [id] } },
            );
            log('korea-pg', `已绑定到渠道 ${target.code}`);
        }
    } else {
        log('korea-pg', '已绑定到目标渠道');
    }
}

async function ensureShippingProfile(target) {
    currentToken = target.token;
    const methods = await channelMethodCodes();
    const shippingIds = SHIPPING_CODES.map(code => methods.shipping.find(m => m.code === code)?.id).filter(Boolean);
    if (shippingIds.length === 0) {
        log('profile', '渠道内无可用配送方式，跳过默认配送档案');
        return null;
    }
    const data = await gql(`query { shippingProfiles { items { id code isTenantDefault enabled shippingMethods { id code } } } }`);
    const profiles = data.shippingProfiles.items;
    let def = profiles.find(p => p.isTenantDefault && p.enabled);

    if (!def) {
        plan(`createShippingProfile(${target.code}-default) + setTenantDefaultShippingProfile`);
        if (!APPLY) return null;
        const created = await gql(
            `mutation($input: CreateShippingProfileInput!) {
                createShippingProfile(input: $input) { id code shippingMethods { code } }
            }`,
            {
                input: {
                    name: '默认配送',
                    code: `${target.code}-default`,
                    enabled: true,
                    shippingMethodIds: shippingIds,
                    methodConfigs: shippingIds.map(id => ({ shippingMethodId: id, mode: 'mail' })),
                },
            },
        );
        const id = created.createShippingProfile.id;
        await gql(`mutation($id: ID!) { setTenantDefaultShippingProfile(id: $id) }`, { id });
        log('profile', `已创建并设为默认档案 ${id}`);
        return id;
    }

    const missing = SHIPPING_CODES.filter(c => !def.shippingMethods.some(m => m.code === c));
    if (missing.length > 0) {
        const ids = [...new Set([...def.shippingMethods.map(m => m.id), ...shippingIds])];
        plan(`updateShippingProfile(${def.id}) 补配送方式 ${missing.join(',')}`);
        if (APPLY) {
            await gql(
                `mutation($input: UpdateShippingProfileInput!) {
                    updateShippingProfile(input: $input) { id shippingMethods { code } }
                }`,
                {
                    input: {
                        id: def.id,
                        shippingMethodIds: ids,
                        methodConfigs: ids.map(id => ({ shippingMethodId: id, mode: 'mail' })),
                    },
                },
            );
            log('profile', '已补配送方式');
        }
    } else {
        log('profile', `默认档案已就绪 ${def.id}（${def.shippingMethods.map(m => m.code).join(',')}）`);
    }
    return def.id;
}

async function assignVariants(profileId) {
    if (!ASSIGN_VARIANTS || !profileId) return;
    const data = await gql(`query { productVariants(options: { take: 500 }) { items { id customFields { shippingProfileId } } } }`);
    const ids = data.productVariants.items
        .filter(v => String(v.customFields?.shippingProfileId ?? '') !== String(profileId))
        .map(v => v.id);
    if (ids.length === 0) {
        log('variants', '变体已全部绑定默认档案');
        return;
    }
    plan(`assignShippingProfile(${ids.length} 个变体 → ${profileId})`);
    if (APPLY) {
        await gql(`mutation($variantIds: [ID!]!, $profileId: ID!) { assignShippingProfile(variantIds: $variantIds, profileId: $profileId) }`, {
            variantIds: ids,
            profileId,
        });
        log('variants', `已绑定 ${ids.length} 个变体`);
    }
}

async function main() {
    if (!TARGET_CHANNEL) {
        throw new Error('必须指定 --channel（如 t25）');
    }
    log('mode', APPLY ? 'apply（会写库）' : 'dry-run（只打印计划，加 --apply 才写）');
    await login();
    const { def, target } = await resolveTargetChannel();
    log('channel', `${target.code}（id=${target.id}）`);
    await ensureZones(def, target);
    await ensureMethods(def, target);
    await ensureKoreaPg(target);
    const profileId = await ensureShippingProfile(target);
    await assignVariants(profileId);
    log('done', APPLY ? '完成' : 'dry-run 结束（未写库）');
}

main().catch(e => {
    console.error(`[failed] ${e.message}`);
    process.exitCode = 1;
});

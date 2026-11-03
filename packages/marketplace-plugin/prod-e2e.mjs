/* eslint-disable no-console */
/**
 * 生产环境 marketplace 全链路端到端验证（全部走 HTTP API，只写带 TEST 标识的测试数据）。
 *
 * 链路：
 *   商家入驻(registerMarketplaceSeller) → 商家创建商品 → 平台同步商品到 default 渠道
 *   → 商家提交上架(submitForMarketplaceAdmin) → 平台审批(approveMarketplaceProduct)
 *   → 顾客跨商家聚合下单 → 支付聚合单触发分单 → 逐单支付商家子单(payMarketplaceSellerOrder)
 *   → 商家分栏查询(merchant-api/orders + merchantOrders) → 对账导出(merchant-api/settlement)
 *
 * 用法：node prod-e2e.mjs [superuser] [superpwd]
 * 默认：superadmin / z123123
 *
 * 测试数据标识（可重复跑，幂等）：
 *   shopName   = Test-Marketplace-Shop （code=test-marketplace-shop）
 *   商家账号   = test-merchant@e.joho.cn / Test123456
 *   商品 barcode = MKT-TEST-<ts>
 *   顾客       = zhao@163.com / 23123
 */
const ADMIN = 'https://e.joho.cn/admin-api';
const SHOP = 'https://e.joho.cn/shop-api';
const REST = 'https://e.joho.cn/merchant-api';

const SUPER = process.argv[2] || 'superadmin';
const SUPER_PWD = process.argv[3] || 'z123123';

// 测试商家固定标识
const SHOP_NAME = 'Test-Marketplace-Shop';
const SHOP_CODE = 'test-marketplace-shop';
const SHOP_TOKEN = `${SHOP_CODE}-token`;
const MERCHANT_EMAIL = 'test-merchant@e.joho.cn';
const MERCHANT_PWD = 'Test123456';
const CUSTOMER_EMAIL = 'zhao@163.com';
const CUSTOMER_PWD = '23123';
const BARCODE = `MKT-TEST-${Date.now() % 100000000}`;

let passCount = 0;
let failCount = 0;
const failedMsgs = [];

function ok(cond, msg) {
    if (cond) {
        passCount++;
        console.log(`  ✓ ${msg}`);
    } else {
        failCount++;
        failedMsgs.push(msg);
        console.error(`  ✗ ${msg}`);
    }
}

async function gql(url, query, variables = {}, auth, chToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = `Bearer ${auth}`;
    if (chToken) headers['vendure-token'] = chToken;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const json = await res.json();
    if (json.errors) {
        const e = json.errors.map((x) => x.message).join('; ');
        const err = new Error('GraphQL: ' + e);
        err.data = json.data;
        throw err;
    }
    return json.data;
}

async function loginAdmin(url, username, password) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: `mutation($u:String!,$p:String!){ login(username:$u,password:$p){ ...on CurrentUser{ id identifier } ...on ErrorResult{ errorCode message } } }`,
            variables: { u: username, p: password },
        }),
    });
    const json = await res.json();
    const cu = json.data?.login;
    if (!cu || !cu.id) throw new Error('admin 登录失败: ' + JSON.stringify(cu));
    return { auth: res.headers.get('vendure-auth-token'), cu };
}

async function loginShop(username, password) {
    const res = await fetch(SHOP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: `mutation($u:String!,$p:String!){ login(username:$u,password:$p){ ...on CurrentUser{ id identifier } ...on ErrorResult{ errorCode message } } }`,
            variables: { u: username, p: password },
        }),
    });
    const json = await res.json();
    const cu = json.data?.login;
    if (!cu || !cu.id) throw new Error('shop 登录失败: ' + JSON.stringify(cu));
    return { auth: res.headers.get('vendure-auth-token'), cu };
}

async function restGet(url, path, token) {
    const res = await fetch(`${url}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`REST ${path} 失败(${res.status}): ` + JSON.stringify(json));
    return json;
}

async function main() {
    console.log(`\n========== 生产 marketplace 端到端验证 ==========`);
    console.log(`[env] admin=${ADMIN} shop=${SHOP}`);

    // ===== 0. 超管登录 + 渠道探测 =====
    console.log('\n[0] 超管登录 + 渠道探测');
    const sup = await loginAdmin(ADMIN, SUPER, SUPER_PWD);
    console.log(`  superadmin 登录成功: ${sup.cu.identifier}`);
    const chR = await gql(
        ADMIN,
        `query{ channels(options:{take:50}){ totalItems items{ id code token seller{ id name } } } }`,
        {},
        sup.auth,
    );
    const channels = chR.channels.items;
    const defaultCh = channels.find((c) => c.code === '__default_channel__') || channels.find((c) => c.code === 'default');
    ok(!!defaultCh, `找到 default 渠道: id=${defaultCh?.id} code=${defaultCh?.code}`);
    console.log(`  渠道列表: ${channels.map((c) => c.code).join(', ')}`);

    // ===== 1. 商家入驻（幂等：已存在则跳过） =====
    console.log('\n[1] 商家入驻');
    let merchantCh = channels.find((c) => c.code === SHOP_CODE);
    if (merchantCh) {
        console.log(`  商家渠道已存在: id=${merchantCh.id} code=${merchantCh.code}`);
    } else {
        const reg = await gql(SHOP, `mutation($input:RegisterMarketplaceSellerInput!){ registerMarketplaceSeller(input:$input){ ...on RegisterMarketplaceSellerSuccess{ id code token } ...on RegisterMarketplaceSellerError{ errorCode message } } }`, {
            input: {
                shopName: SHOP_NAME,
                seller: {
                    firstName: '测试',
                    lastName: '商家',
                    emailAddress: MERCHANT_EMAIL,
                    password: MERCHANT_PWD,
                },
            },
        });
        const success = reg.registerMarketplaceSeller;
        ok(!!success?.id && !success.errorCode, `注册商家: ${success?.code ?? JSON.stringify(success)}`);
        merchantCh = success?.id
            ? { id: success.id, code: success.code, token: success.token }
            : null;
    }
    const merchantChannelId = merchantCh?.id;
    const merchantToken = merchantCh?.token || SHOP_TOKEN;
    ok(!!merchantChannelId, `商家渠道 id=${merchantChannelId}`);

    // merchant-api 使用服务端签发令牌（Channel token 在生产已不允许作 Bearer）
    const issued = await gql(
        ADMIN,
        `mutation($id:ID!){ issueMerchantApiToken(channelId:$id){ token expiresAt } }`,
        { id: merchantChannelId },
        sup.auth,
        SHOP_TOKEN,
    );
    const merchantApiToken = issued.issueMerchantApiToken?.token;
    ok(!!merchantApiToken, '已签发 merchant-api 令牌');

    // ===== 2. 商家 admin 登录 + 创建测试商品 =====
    console.log('\n[2] 商家创建测试商品');
    const merch = await loginAdmin(ADMIN, MERCHANT_EMAIL, MERCHANT_PWD);
    console.log(`  商家 admin 登录成功: ${merch.cu.identifier}`);
    const prod = await gql(
        ADMIN,
        `mutation($input:CreateProductInput!){ createProduct(input:$input){ id name slug customFields{ barcode internalCode } } }`,
        {
            input: {
                translations: [
                    { languageCode: 'zh_Hans', name: '【测试】商家市场商品', slug: `mkt-test-${Date.now() % 100000}`, description: 'marketplace 生产端到端验证测试商品' },
                ],
                customFields: { barcode: BARCODE, internalCode: 'MKT-INT-TEST' },
            },
        },
        merch.auth,
        merchantToken,
    );
    const product = prod.createProduct;
    ok(!!product?.id, `商品已创建: id=${product?.id} barcode=${product?.customFields?.barcode}`);
    const variant = await gql(
        ADMIN,
        `mutation($input:[CreateProductVariantInput!]!){ createProductVariants(input:$input){ id sku priceWithTax } }`,
        {
            input: [
                {
                    productId: product.id,
                    sku: `MKT-TEST-${Date.now() % 100000}`,
                    price: 8800,
                    translations: [{ languageCode: 'zh_Hans', name: '测试规格-标准款' }],
                },
            ],
        },
        merch.auth,
        merchantToken,
    );
    const mkVariant = variant.createProductVariants[0];
    ok(!!mkVariant?.id, `变体已创建: sku=${mkVariant?.sku} price=${mkVariant?.priceWithTax}`);

    // 2.1 商家为变体补库存（setVariantStock 到商家仓，避免 INSUFFICIENT_STOCK）
    console.log('\n[2.1] 商家变体补库存');
    const slR = await gql(
        ADMIN,
        `query{ stockLocations(options:{take:50}){ items{ id name } } }`,
        {},
        merch.auth,
        merchantToken,
    );
    const merchantLoc =
        slR.stockLocations.items.find(l => l.name.includes(SHOP_NAME)) || slR.stockLocations.items[0];
    ok(!!merchantLoc, `商家仓: ${merchantLoc?.name} (id=${merchantLoc?.id})`);
    const stk = await gql(
        ADMIN,
        `mutation($productVariantId:ID!,$stockLocationId:ID!,$stockOnHand:Int!){ setVariantStock(productVariantId:$productVariantId, stockLocationId:$stockLocationId, stockOnHand:$stockOnHand) }`,
        { productVariantId: mkVariant.id, stockLocationId: merchantLoc.id, stockOnHand: 100 },
        sup.auth,
        merchantToken,
    );
    ok(stk.setVariantStock === true, `商家变体库存=100: ${stk.setVariantStock}`);

    // ===== 3. 平台把商家商品同步到 default 渠道（变体恰好 2 渠道 = 分单前提） =====
    console.log('\n[3] 平台同步商品到 default 渠道');
    await gql(
        ADMIN,
        `mutation($input:AssignProductsToChannelInput!){ assignProductsToChannel(input:$input){ id } }`,
        { input: { channelId: defaultCh.id, productIds: [product.id] } },
        sup.auth,
    );
    const assignVar = await gql(
        ADMIN,
        `mutation($input:AssignProductVariantsToChannelInput!){ assignProductVariantsToChannel(input:$input){ id } }`,
        { input: { channelId: defaultCh.id, productVariantIds: [mkVariant.id] } },
        sup.auth,
    );
    ok(assignVar.assignProductVariantsToChannel?.length === 1, `变体已挂 default 渠道（2 渠道=分单前提）`);

    // ===== 4. 商家提交上架 + 平台审批 =====
    console.log('\n[4] 商家提交上架 + 平台审批');
    const sub = await gql(
        ADMIN,
        `mutation($productId:ID!){ submitForMarketplaceAdmin(productId:$productId) }`,
        { productId: product.id },
        merch.auth,
        merchantToken,
    );
    ok(sub.submitForMarketplaceAdmin === true, '商家提交上架(submitForMarketplaceAdmin)');
    const pending = await gql(ADMIN, `query{ marketplacePendingProducts{ id name } }`, {}, sup.auth);
    const inPending = pending.marketplacePendingProducts?.some((p) => `${p.id}` === `${product.id}`);
    ok(inPending, '提交后处于待审批(pending)');

    const appr = await gql(
        ADMIN,
        `mutation($productId:ID!){ approveMarketplaceProduct(productId:$productId) }`,
        { productId: product.id },
        sup.auth,
    );
    ok(appr.approveMarketplaceProduct === true, '平台审批通过(approveMarketplaceProduct)');

    const mktProd = await gql(SHOP, `query{ marketplaceProducts{ id name merchantChannel{ id code name } } }`);
    const shown = mktProd.marketplaceProducts?.find((p) => `${p.id}` === `${product.id}`);
    ok(!!shown, '审批后出现在 marketplace 商品列表');
    ok(shown?.merchantChannel?.code === SHOP_CODE, `merchantChannel 指向商家渠道: ${shown?.merchantChannel?.code ?? 'null'}`);

    // ===== 5. 商家渠道补配支付方式（逐单支付前置） =====
    console.log('\n[5] 商家渠道补配支付方式');
    const pmR = await gql(ADMIN, `query{ paymentMethods(options:{take:50}){ items{ id code enabled } } }`, {}, sup.auth);
    const cod = pmR.paymentMethods.items.find((p) => p.code === 'cash-on-delivery');
    ok(!!cod, `default 渠道有 cash-on-delivery(id=${cod?.id})`);
    await gql(
        ADMIN,
        `mutation($input:AssignPaymentMethodsToChannelInput!){ assignPaymentMethodsToChannel(input:$input){ id } }`,
        { input: { channelId: merchantChannelId, paymentMethodIds: [cod.id] } },
        sup.auth,
    );
    const pmChk = await gql(
        ADMIN,
        `query{ paymentMethods(options:{take:50}){ items{ id code } } }`,
        {},
        sup.auth,
        merchantToken,
    );
    ok(pmChk.paymentMethods.items.some((p) => `${p.id}` === `${cod.id}`), 'cash-on-delivery 已挂到商家渠道');

    // ===== 6. 顾客跨商家聚合下单 =====
    console.log('\n[6] 顾客跨商家聚合下单');
    const cust = await loginShop(CUSTOMER_EMAIL, CUSTOMER_PWD);
    console.log(`  顾客登录成功: ${cust.cu.identifier}`);

    // 6.1 清理 activeOrder（若有则清空行，避免残留商品）
    let ao = await gql(SHOP, `query{ activeOrder{ id code state lines{ id productVariant{ id } } } }`, {}, cust.auth);
    if (ao.activeOrder?.lines?.length) {
        await gql(SHOP, `mutation{ removeAllOrderLines{ ...on Order{ id state } } }`, {}, cust.auth);
        console.log('  已清空 activeOrder 残留行');
    }

    // 6.2 取自营可用变体（enabled 且库存>0）
    const varR = await gql(
        ADMIN,
        `query{ productVariants(options:{take:50}){ items{ id sku enabled stockOnHand } } }`,
        {},
        sup.auth,
    );
    const selfVariant = varR.productVariants.items.find((v) => v.enabled && v.stockOnHand > 0 && `${v.id}` !== `${mkVariant.id}`);
    ok(!!selfVariant, `自营可用变体: sku=${selfVariant?.sku} stock=${selfVariant?.stockOnHand}`);
    if (!selfVariant) return;

    // 6.3 加入自营 + 商家商品
    const add1 = await gql(
        SHOP,
        `mutation($productVariantId:ID!,$quantity:Int!){ addItemToOrder(productVariantId:$productVariantId, quantity:$quantity){ ...on Order{ id code totalWithTax } ...on ErrorResult{ errorCode message } } }`,
        { productVariantId: selfVariant.id, quantity: 1 },
        cust.auth,
    );
    ok(!add1.addItemToOrder?.errorCode, `加入自营商品: ${add1.addItemToOrder?.errorCode ?? 'OK'}`);
    const add2 = await gql(
        SHOP,
        `mutation($productVariantId:ID!,$quantity:Int!){ addItemToOrder(productVariantId:$productVariantId, quantity:$quantity){ ...on Order{ id code totalWithTax } ...on ErrorResult{ errorCode message } } }`,
        { productVariantId: mkVariant.id, quantity: 1 },
        cust.auth,
    );
    ok(!add2.addItemToOrder?.errorCode, `加入商家商品: ${add2.addItemToOrder?.errorCode ?? 'OK'}`);
    if (add2.addItemToOrder?.errorCode) {
        console.error('    addItemToOrder 失败详情:', JSON.stringify(add2.addItemToOrder));
    }

    // 6.4 设置配送地址 + 配送方式（store-pickup 覆盖全订单）(生产 schema: CreateAddressInput)
    const addr = await gql(
        SHOP,
        `mutation($input:CreateAddressInput!){ setOrderShippingAddress(input:$input){ ...on Order{ id } ...on ErrorResult{ errorCode message } } }`,
        {
            input: {
                fullName: '测试顾客',
                streetLine1: '北京市海淀区中关村大街1号',
                city: '北京市',
                province: '北京市',
                postalCode: '100080',
                countryCode: 'CN',
            },
        },
        cust.auth,
    );
    ok(!addr.setOrderShippingAddress?.errorCode, '设置配送地址');
    const smR = await gql(
        ADMIN,
        `query{ shippingMethods(options:{take:50}){ items{ id code } } }`,
        {},
        sup.auth,
        defaultCh.token,
    );
    const storePickup = smR.shippingMethods.items.find((s) => s.code === 'store-pickup');
    ok(!!storePickup, `default 配送方式 store-pickup(id=${storePickup?.id})`);
    const ship = await gql(
        SHOP,
        `mutation($shippingMethodId:[ID!]!){ setOrderShippingMethod(shippingMethodId:$shippingMethodId){ ...on Order{ id totalWithTax } ...on ErrorResult{ errorCode message } } }`,
        { shippingMethodId: [storePickup.id] },
        cust.auth,
    );
    ok(!ship.setOrderShippingMethod?.errorCode, `设置配送方式: ${ship.setOrderShippingMethod?.errorCode ?? 'OK'}`);

    // 6.5 转换 ArrangingPayment
    const toArr = await gql(
        SHOP,
        `mutation($state:String!){ transitionOrderToState(state:$state){ ...on Order{ id state } ...on ErrorResult{ errorCode message } } }`,
        { state: 'ArrangingPayment' },
        cust.auth,
    );
    ok(!toArr.transitionOrderToState?.errorCode && toArr.transitionOrderToState?.state === 'ArrangingPayment', `订单已到 ArrangingPayment: ${toArr.transitionOrderToState?.state ?? toArr.transitionOrderToState?.errorCode}`);

    // ===== 7. 支付聚合单 → 触发分单 =====
    console.log('\n[7] 支付聚合单 → 触发分单');
    const payAgg = await gql(
        SHOP,
        `mutation($input:PaymentInput!){ addPaymentToOrder(input:$input){ ...on Order{ id code state totalWithTax } ...on ErrorResult{ errorCode message } } }`,
        { input: { method: 'cash-on-delivery', metadata: {} } },
        cust.auth,
    );
    ok(!payAgg.addPaymentToOrder?.errorCode, `聚合单支付成功: state=${payAgg.addPaymentToOrder?.state ?? payAgg.addPaymentToOrder?.errorCode}`);

    // 7.1 顾客查询自己的 marketplace 商家子单
    const myOrders = await gql(SHOP, `query{ myMarketplaceSellerOrders{ id code state totalWithTax sellerChannelName } }`, {}, cust.auth);
    const sellerOrder = myOrders.myMarketplaceSellerOrders?.find((o) => o.sellerChannelName?.toLowerCase() === SHOP_CODE.toLowerCase())
        || myOrders.myMarketplaceSellerOrders?.find((o) => o.state === 'ArrangingPayment' || o.state === 'PaymentAuthorized');
    ok(!!sellerOrder, `分单产生商家子单: ${sellerOrder?.code ?? '未找到'}`);
    if (!sellerOrder) {
        console.error('    myMarketplaceSellerOrders:', JSON.stringify(myOrders.myMarketplaceSellerOrders));
        return;
    }

    // ===== 8. 逐单支付商家子单 =====
    console.log('\n[8] 逐单支付商家子单');
    const paySeller = await gql(
        SHOP,
        `mutation($orderId:ID!,$method:String!,$metadata:JSON){ payMarketplaceSellerOrder(orderId:$orderId, method:$method, metadata:$metadata){ ...on Order{ id code state totalWithTax } ...on ErrorResult{ errorCode message } } }`,
        { orderId: sellerOrder.id, method: 'cash-on-delivery', metadata: {} },
        cust.auth,
    );
    const payRes = paySeller.payMarketplaceSellerOrder;
    ok(!payRes?.errorCode, `商家子单(code=${sellerOrder.code})逐单支付成功: state=${payRes?.state ?? payRes?.errorCode}`);

    // ===== 9. 商家分栏查询 + 对账导出 =====
    console.log('\n[9] 商家分栏查询 + 对账导出');
    const mOrders = await restGet(REST, '/orders', merchantApiToken);
    ok(mOrders.items?.some((o) => `${o.orderId}` === `${sellerOrder.id}`), `merchant-api/orders 命中商家子单(${mOrders.count} 单)`);
    const mOrdersAll = await restGet(REST, '/orders', merchantApiToken);
    ok(mOrdersAll.count > 0, `商家分栏订单总数=${mOrdersAll.count}`);

    const merchOrdersQ = await gql(
        ADMIN,
        `query{ merchantOrders(saleSource:"marketplace", options:{take:50}){ totalItems items{ id code state customFields{ saleSource } } } }`,
        {},
        merch.auth,
        merchantToken,
    );
    ok(merchOrdersQ.merchantOrders?.totalItems > 0, `商家后台 merchantOrders(saleSource=marketplace) 命中 ${merchOrdersQ.merchantOrders?.totalItems} 单`);
    const srcOk = merchOrdersQ.merchantOrders?.items?.every((o) => o.customFields?.saleSource === 'marketplace');
    ok(srcOk !== false, '商家分栏全部为 marketplace 销售来源');

    const settle = await restGet(REST, '/settlement', merchantApiToken);
    ok(settle.entries?.some((e) => `${e.orderId}` === `${sellerOrder.id}`), `对账导出命中商家子单(state=${settle.entries?.find((e) => `${e.orderId}` === `${sellerOrder.id}`)?.state})`);
    console.log(`  对账总单数=${settle.count} 总额(分)=${settle.totalWithTax}`);

    // ===== 汇总 =====
    console.log(`\n========== 验证汇总 ==========`);
    console.log(`通过: ${passCount}, 失败: ${failCount}`);
    if (failCount > 0) {
        console.log('失败项:');
        failedMsgs.forEach((m) => console.log(`  - ${m}`));
        process.exit(1);
    }
    console.log('✅ 生产 marketplace 全链路端到端验证全部通过');
}

main().catch((e) => {
    console.error('\n=== 验证异常 ===');
    console.error(e.message);
    if (e.data) console.error('data=', JSON.stringify(e.data));
    process.exit(2);
});

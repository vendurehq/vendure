import path from 'node:path';
import {
  createTestEnvironment,
  registerInitializer,
  SqljsInitializer,
  testConfig,
} from '@vendure/testing';
import { configureDefaultOrderProcess, DefaultLogger, LogLevel } from '@vendure/core';
import gql from 'graphql-tag';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { VcashPosPlugin } from '../src/plugin';
// 直接引用 marketplace 的订单流程源码：本用例专门复刻线上"POS 单叠加 marketplace 流程"的组合，
// 验证 POS 建单写入 orderKind='assistant' 后不再被 "not all lines have shipping" 阻断。
import { marketplaceOrderProcess } from '../../marketplace-plugin/src/marketplace-order-process';

registerInitializer('sqljs', new SqljsInitializer('__data__'));

const posOrderProcess = configureDefaultOrderProcess({
  arrangingPaymentRequiresCustomer: false,
  arrangingPaymentRequiresShipping: false,
});

const ORDER_WITH_ORDER_KIND = gql`
  query OrderWithOrderKind($id: ID!) {
    order(id: $id) {
      id
      state
      active
      customFields {
        posSessionId
        orderType
        orderKind
      }
      lines {
        id
        quantity
      }
    }
  }
`;

const GET_PRODUCTS = gql`
  query GetProducts {
    products {
      items {
        id
        variants {
          id
          sku
        }
      }
    }
  }
`;

const CREATE_STOCK_LOCATION = gql`
  mutation CreateStockLocation($name: String!) {
    createStockLocation(input: { name: $name }) {
      id
      name
    }
  }
`;

const CREATE_TERMINAL = gql`
  mutation CreateTerminal($code: String!, $name: String!, $stockLocationId: ID!) {
    createPosTerminal(input: { code: $code, name: $name, stockLocationId: $stockLocationId }) {
      id
      code
      name
    }
  }
`;

const OPEN_SESSION = gql`
  mutation OpenSession($terminalCode: String!) {
    openSession(input: { terminalCode: $terminalCode }) {
      id
      code
      state
    }
  }
`;

const ADD_POS_ITEM = gql`
  mutation AddPosItem($productVariantId: ID!, $quantity: Int!, $discount: Int) {
    addPosItem(input: { productVariantId: $productVariantId, quantity: $quantity, discount: $discount }) {
      id
      state
      totalWithTax
    }
  }
`;

const CHECKOUT = gql`
  mutation Checkout($payments: [CheckoutPaymentInput!]!) {
    checkoutPosOrder(input: { payments: $payments }) {
      order {
        id
        state
        totalWithTax
        payments {
          id
          amount
          state
          method
        }
      }
      payments {
        id
        amount
        state
        method
      }
    }
  }
`;

const CREATE_REFUND_ORDER = gql`
  mutation CreateRefundOrder($originalOrderId: ID!, $refundLines: [RefundLineInput!]!) {
    createRefundOrder(input: { originalOrderId: $originalOrderId, refundLines: $refundLines }) {
      refundOrder {
        id
        state
        totalWithTax
        customFields {
          orderType
          orderKind
        }
        payments {
          id
          amount
          state
          method
        }
      }
    }
  }
`;

const CLOSE_SESSION = gql`
  mutation CloseSession($sessionId: ID!, $closingCash: Int) {
    closeSession(input: { sessionId: $sessionId, closingCash: $closingCash }) {
      session {
        id
        code
        state
        closedAt
      }
      summary
    }
  }
`;

describe('POS 建单 + marketplace 订单流程（orderKind=assistant 回归）', () => {
  const { server, adminClient } = createTestEnvironment({
    ...testConfig,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    // 线上 orderKind 由 campus-delivery 插件注册；此处显式注册同一字段以复刻线上配置
    customFields: {
      ...(testConfig.customFields as any),
      Order: [
        ...(((testConfig.customFields as any)?.Order as any[]) ?? []),
        { name: 'orderKind', type: 'string', nullable: true, defaultValue: 'normal' },
      ],
    } as any,
    // 关键：同时启用 marketplace 流程；修复前该流程会因 POS 单无 shippingLineId 阻断结账
    orderOptions: { process: [posOrderProcess, marketplaceOrderProcess] },
    plugins: [VcashPosPlugin],
  });

  let variantId: string;
  let sessionId: string;
  let orderId: string;

  beforeAll(async () => {
    await server.init({
      initialData: {
        defaultLanguage: 'en',
        defaultZone: 'Asia',
        roles: [],
        countries: [{ code: 'CN', name: '中国', zone: 'Asia' }],
        taxRates: [{ name: 'standard', percentage: 0 }],
        shippingMethods: [],
        paymentMethods: [],
        collections: [],
      },
      productsCsvPath: path.join(
        __dirname,
        '../../core/mock-data/data-sources/products.csv',
      ),
    });
    await adminClient.asSuperAdmin();

    const productsRes = await adminClient.query(GET_PRODUCTS);
    expect(productsRes.products.items.length).toBeGreaterThan(0);
    variantId = productsRes.products.items[0].variants[0].id;

    const sl = await adminClient.query(CREATE_STOCK_LOCATION, { name: '回归门店' });
    await adminClient.query(CREATE_TERMINAL, {
      code: 'POS-REG-001',
      name: '回归收银台',
      stockLocationId: sl.createStockLocation.id,
    });
    const session = await adminClient.query(OPEN_SESSION, { terminalCode: 'POS-REG-001' });
    sessionId = session.openSession.id;
    expect(session.openSession.state).toBe('open');
  }, 180000);

  afterAll(async () => {
    await server.destroy();
  });

  it('POS 建单自动写入 orderKind=assistant（走 customFields，无需 admin 事后补丁）', async () => {
    const added = await adminClient.query(ADD_POS_ITEM, {
      productVariantId: variantId,
      quantity: 1,
      discount: 100,
    });
    orderId = added.addPosItem.id;
    expect(added.addPosItem.state).toBe('AddingItems');

    const order = await adminClient.query(ORDER_WITH_ORDER_KIND, { id: orderId });
    expect(order.order.customFields.orderKind).toBe('assistant');
    expect(order.order.customFields.orderType).toBe('sale');
  });

  it('在 marketplace 流程下 checkout 应全绿：Order=PaymentSettled，Payment=Settled', async () => {
    const result = await adminClient.query(CHECKOUT, { payments: [{ method: 'cash' }] });
    const { order, payments } = result.checkoutPosOrder;
    expect(order.state).toBe('PaymentSettled');
    expect(order.payments.length).toBe(1);
    expect(order.payments[0].state).toBe('Settled');
    expect(order.payments[0].method).toBe('cash');
    expect(payments[0].amount).toBe(order.totalWithTax);
  });

  it('退货单同样豁免 shipping 校验：refundOrder=PaymentSettled 且 orderKind=assistant', async () => {
    const settled = await adminClient.query(ORDER_WITH_ORDER_KIND, { id: orderId });
    expect(settled.order.active).toBe(false);

    const refund = await adminClient.query(CREATE_REFUND_ORDER, {
      originalOrderId: orderId,
      refundLines: [{ orderLineId: settled.order.lines[0].id, quantity: 1 }],
    });
    const refundOrder = refund.createRefundOrder.refundOrder;
    expect(refundOrder.state).toBe('PaymentSettled');
    expect(refundOrder.customFields.orderKind).toBe('assistant');
    expect(refundOrder.customFields.orderType).toBe('refund');
    expect(refundOrder.payments[0].state).toBe('Settled');
  });

  it('closeSession 能正常关闭并生成对账摘要', async () => {
    const closed = await adminClient.query(CLOSE_SESSION, { sessionId, closingCash: 0 });
    expect(closed.closeSession.session.state).toBe('closed');
    expect(closed.closeSession.summary.orders.totalCount).toBeGreaterThanOrEqual(2);
  });
});

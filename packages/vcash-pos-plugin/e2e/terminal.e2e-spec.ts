import path from 'node:path';
import {
  createTestEnvironment,
  registerInitializer,
  SqljsInitializer,
  testConfig,
} from '@vendure/testing';
import { DefaultLogger, LogLevel } from '@vendure/core';
import gql from 'graphql-tag';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { VcashPosPlugin } from '../src/plugin';

registerInitializer('sqljs', new SqljsInitializer('__data__'));

const CREATE_STOCK_LOCATION = gql`
  mutation CreateStockLocation($name: String!) {
    createStockLocation(input: { name: $name }) { id name }
  }
`;

const CREATE_TERMINAL = gql`
  mutation CreateTerminal($code: String!, $name: String!, $stockLocationId: ID!) {
    createPosTerminal(input: { code: $code, name: $name, stockLocationId: $stockLocationId }) {
      id code name active
    }
  }
`;

const LIST_TERMINALS = gql`
  query ListTerminals { posTerminals { id code name } }
`;

const LIST_TERMINALS_FULL = gql`
  query ListTerminalsFull {
    posTerminals { id code channel { id code } stockLocation { id name } }
  }
`;

const UPDATE_TERMINAL = gql`
  mutation UpdateTerminal($id: ID!, $name: String) {
    updatePosTerminal(input: { id: $id, name: $name }) { id name }
  }
`;

const DELETE_TERMINAL = gql`
  mutation DeleteTerminal($id: ID!) { deletePosTerminal(id: $id) }
`;

const OPEN_SESSION = gql`
  mutation OpenSession($terminalCode: String!, $openingFloat: Int) {
    openSession(input: { terminalCode: $terminalCode, openingFloat: $openingFloat }) { id code }
  }
`;

describe('PosTerminal CRUD', () => {
  const { server, adminClient } = createTestEnvironment({
    ...testConfig,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    plugins: [VcashPosPlugin],
  });

  let stockLocationId: string;

  beforeAll(async () => {
    await server.init({
      initialData: {
        defaultLanguage: 'en',
        defaultZone: 'Asia',
        roles: [
          { code: 'cashier', description: '收银员', permissions: ['Authenticated'] },
          { code: 'shift-manager', description: '班次经理', permissions: ['Authenticated'] },
        ],
        countries: [{ code: 'CN', name: '中国', zone: 'Asia' }],
        taxRates: [{ name: 'standard', percentage: 0 }],
        shippingMethods: [],
        paymentMethods: [],
        collections: [],
      },
      productsCsvPath: path.join(
        __dirname,
        '../../../server/__tests__/fixtures/products.csv',
      ),
    });
    await adminClient.asSuperAdmin();

    // 创建一个仓库供 PosTerminal 绑定（StockLocation 无 code 字段，仅 name/description）
    const sl = await adminClient.query(CREATE_STOCK_LOCATION, { name: '朝阳店' });
    expect(sl.createStockLocation.name).toBe('朝阳店');
    stockLocationId = sl.createStockLocation.id;
  }, 180000);

  afterAll(async () => {
    await server.destroy();
  });

  it('应创建 PosTerminal', async () => {
    const result = await adminClient.query(CREATE_TERMINAL, {
      code: 'POS-001',
      name: '1号收银台',
      stockLocationId,
    });
    expect(result.createPosTerminal.code).toBe('POS-001');
    expect(result.createPosTerminal.name).toBe('1号收银台');
    expect(result.createPosTerminal.active).toBe(true);
  });

  it('应查询 PosTerminal', async () => {
    const result = await adminClient.query(LIST_TERMINALS);
    expect(result.posTerminals.length).toBe(1);
    expect(result.posTerminals[0].code).toBe('POS-001');
  });

  it('应更新 PosTerminal', async () => {
    const terminals = await adminClient.query(LIST_TERMINALS);
    const id = terminals.posTerminals[0].id;
    const result = await adminClient.query(UPDATE_TERMINAL, { id, name: '前台收银' });
    expect(result.updatePosTerminal.name).toBe('前台收银');
  });

  it('应删除 PosTerminal', async () => {
    const terminals = await adminClient.query(LIST_TERMINALS);
    const id = terminals.posTerminals[0].id;
    const result = await adminClient.query(DELETE_TERMINAL, { id });
    expect(result.deletePosTerminal).toBe(true);
    const after = await adminClient.query(LIST_TERMINALS);
    expect(after.posTerminals.length).toBe(0);
  });

  it('创建重复 code 应报错', async () => {
    await adminClient.query(CREATE_TERMINAL, {
      code: 'POS-DUP',
      name: 'T1',
      stockLocationId,
    });
    await expect(
      adminClient.query(CREATE_TERMINAL, {
        code: 'POS-DUP',
        name: 'T2',
        stockLocationId,
      }),
    ).rejects.toThrow();
  });

  it('channel/stockLocation 关联应可查询', async () => {
    const result = await adminClient.query(LIST_TERMINALS_FULL);
    const t = result.posTerminals.find((x: any) => x.code === 'POS-DUP');
    expect(t).toBeTruthy();
    expect(t.channel.code).toBeTruthy();
    expect(t.stockLocation.name).toBe('朝阳店');
  });

  it('有历史班次时删除应被阻止并保留终端', async () => {
    const created = await adminClient.query(CREATE_TERMINAL, {
      code: 'POS-HIST',
      name: '历史台',
      stockLocationId,
    });
    const id = created.createPosTerminal.id;

    await adminClient.query(OPEN_SESSION, { terminalCode: 'POS-HIST', openingFloat: 0 });

    await expect(adminClient.query(DELETE_TERMINAL, { id })).rejects.toThrow(/班次/);

    const after = await adminClient.query(LIST_TERMINALS);
    expect(after.posTerminals.some((x: any) => x.code === 'POS-HIST')).toBe(true);
  });
});

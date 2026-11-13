import type { Mock } from 'vitest';

export type MockClass<T> = { [K in keyof T]: Mock<any> | any };

export type MockClass<T> = { [K in keyof T]: vi.Mock<any> | any };

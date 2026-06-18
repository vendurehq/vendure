export type MockOf<T> = { [K in keyof T]: T[K] };

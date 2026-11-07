import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // e2e 中被测插件以 src 运行，而 notification-plugin 经 package.json main 解析到旧 lib；
            // EventBus.ofType 用 constructor 严格相等匹配事件类，src/lib 两个类引用会导致订阅永不触发。
            // 统一 alias 到 src 保证发布/订阅同一类引用（生产环境双方均为 lib，天然一致）。
            '@vendure/after-sales-plugin': path.resolve(__dirname, 'index.ts'),
        },
    },
    test: {
        include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
        testTimeout: process.env.E2E_DEBUG ? 1800 * 1000 : process.env.CI ? 30 * 1000 : 15 * 1000,
        allowOnly: true,
        // inline 后 alias 才对 node_modules 依赖生效（external 模块由 Node 原生解析，绕过 vite alias）
        server: {
            deps: {
                inline: ['@vendure/after-sales-plugin'],
            },
        },
    },
    plugins: [
        swc.vite({
            jsc: {
                transform: {
                    useDefineForClassFields: false,
                },
            },
        }),
    ],
});

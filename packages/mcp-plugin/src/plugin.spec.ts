import { preloadSchemas } from '@modelcontextprotocol/server';
import { getConfigurationFunction, I18nService, Logger, ProcessContext } from '@vendure/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResolvedMcpPluginOptions } from './internal-types';
import { McpPlugin } from './plugin';
import { resolveMcpPluginOptions } from './resolve-options';
import { mcpOauthRetentionTask } from './tasks/mcp-oauth-retention.task';
import { McpPluginOptions } from './types';

// Only `preloadSchemas` is stubbed; everything else in the SDK stays real, because the plugin
// module graph loads the transport controller from the same package.
vi.mock('@modelcontextprotocol/server', async importOriginal => ({
    ...(await importOriginal<typeof import('@modelcontextprotocol/server')>()),
    preloadSchemas: vi.fn(),
}));

/** Runs the plugin's real `configuration` hook against a minimal config and returns it. */
async function runConfiguration() {
    const config = {
        apiOptions: { port: 3000 },
        authOptions: { customPermissions: [] },
        settingsStoreFields: {},
        schedulerOptions: { tasks: [] },
    } as any;
    await getConfigurationFunction(McpPlugin)?.(config);
    return config;
}

/** Resolves a ScheduledTask's (function-form) schedule to "H:M" without cron-time-generator. */
function resolveDayTime(task: any): string {
    const schedule = task.options.schedule as (cron: {
        everyDayAt: (h: number, m: number) => string;
    }) => string;
    return schedule({ everyDayAt: (h, m) => `${h}:${m}` });
}

describe('McpPlugin production config guard', () => {
    let savedOptions: ResolvedMcpPluginOptions;
    let savedNodeEnv: string | undefined;

    beforeEach(() => {
        savedOptions = McpPlugin.options;
        savedNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        McpPlugin.options = savedOptions;
        process.env.NODE_ENV = savedNodeEnv;
    });

    function createPlugin(isServer: boolean): McpPlugin {
        const processContext = { isServer } as ProcessContext;
        return new McpPlugin(processContext, {} as I18nService);
    }

    function setOauth(oauth: McpPluginOptions['oauth']): void {
        McpPlugin.options = resolveMcpPluginOptions({ toolExposure: 'direct', oauth });
    }

    it('throws in production when the issuer is a localhost URL', () => {
        process.env.NODE_ENV = 'production';
        setOauth({ tokenSecret: 'x', issuer: 'http://localhost:3500' });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).toThrow();
    });

    it('does not throw in production when issuer and storefrontConsentUrl are public URLs', () => {
        process.env.NODE_ENV = 'production';
        setOauth({
            tokenSecret: 'x',
            issuer: 'https://shop.example.com',
            storefrontConsentUrl: 'https://shop.example.com/mcp/authorize',
        });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).not.toThrow();
    });

    it('throws in production when the storefrontConsentUrl is a localhost URL', () => {
        process.env.NODE_ENV = 'production';
        setOauth({
            tokenSecret: 'x',
            issuer: 'https://shop.example.com',
            storefrontConsentUrl: 'http://localhost:3000/mcp/authorize',
        });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).toThrow();
    });

    // A deployment that only uses the admin toolset must be able to start in production
    // without ever configuring a storefront consent page.
    it('does not throw in production when the issuer is public and storefrontConsentUrl is unset', () => {
        process.env.NODE_ENV = 'production';
        setOauth({ tokenSecret: 'x', issuer: 'https://shop.example.com' });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).not.toThrow();
    });

    // An empty value is almost always an environment variable that did not resolve, so the message
    // must name that rather than read the empty string as a loopback URL.
    it('throws in production when the storefrontConsentUrl is an empty string', () => {
        process.env.NODE_ENV = 'production';
        setOauth({
            tokenSecret: 'x',
            issuer: 'https://shop.example.com',
            storefrontConsentUrl: '',
        });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).toThrow(/storefrontConsentUrl is empty/);
    });

    it('throws in production when the storefrontConsentUrl is a public but plain-HTTP URL', () => {
        process.env.NODE_ENV = 'production';
        setOauth({
            tokenSecret: 'x',
            issuer: 'https://shop.example.com',
            storefrontConsentUrl: 'http://shop.example.com/mcp/authorize',
        });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).toThrow();
    });

    // Every OAuth and MCP URL is built from the issuer, and the `.well-known` documents are
    // served at the server root, so an issuer with a path yields URLs nothing serves. Refused
    // in development too, because that is where such a misconfiguration is discovered cheaply.
    it('throws when the issuer is more than a scheme, host and port', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ tokenSecret: 'x', issuer: 'https://example.com/vendure' });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/no path, query or fragment/);

        setOauth({ tokenSecret: 'x', issuer: 'https://example.com?tenant=1' });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/no path, query or fragment/);

        setOauth({ tokenSecret: 'x', issuer: 'https://example.com#frag' });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/no path, query or fragment/);
    });

    // Left to run, a schemeless issuer boots fine and then turns the first unauthenticated
    // request's 401 into a 500, because building the challenge URL from it throws.
    it('throws when the issuer is not a URL at all', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ tokenSecret: 'x', issuer: 'example.com' });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/must be a valid URL/);
    });

    it('accepts an issuer that is a bare origin, with or without a trailing slash', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ tokenSecret: 'x', issuer: 'https://example.com' });
        expect(() => createPlugin(true).onApplicationBootstrap()).not.toThrow();

        setOauth({ tokenSecret: 'x', issuer: 'https://example.com/' });
        expect(() => createPlugin(true).onApplicationBootstrap()).not.toThrow();
    });

    // `new URL(path, issuer)` silently ignores the issuer when the path is a full URL or a
    // "//host/path" form, sending the consent page's requests to the wrong host. Refused in
    // development too, so the misconfiguration is discovered cheaply.
    it('throws when adminConsentPath is not a server-relative path', () => {
        process.env.NODE_ENV = 'development';
        setOauth({
            tokenSecret: 'x',
            issuer: 'https://example.com',
            adminConsentPath: 'https://dashboard.example.com/mcp/authorize',
        });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/adminConsentPath/);

        setOauth({
            tokenSecret: 'x',
            issuer: 'https://example.com',
            adminConsentPath: '//dashboard.example.com/mcp/authorize',
        });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/adminConsentPath/);

        setOauth({
            tokenSecret: 'x',
            issuer: 'https://example.com',
            adminConsentPath: '/custom/consent/page',
        });
        expect(() => createPlugin(true).onApplicationBootstrap()).not.toThrow();
    });

    it('throws when oauth is configured without a tokenSecret', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ issuer: 'https://example.com' } as any);
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/tokenSecret/);
    });

    it('throws when tokenSecret is an empty string', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ tokenSecret: '', issuer: 'https://example.com' });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/tokenSecret/);
    });

    it('does not throw when not running on the server process', () => {
        process.env.NODE_ENV = 'production';
        setOauth({ tokenSecret: 'x', issuer: 'http://localhost:3500' });
        const plugin = createPlugin(false);
        expect(() => plugin.onApplicationBootstrap()).not.toThrow();
    });

    it('does not throw when oauth is not configured', () => {
        process.env.NODE_ENV = 'production';
        setOauth(undefined);
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).not.toThrow();
    });

    it('does not throw in development even with a localhost issuer', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ tokenSecret: 'x', issuer: 'http://localhost:3500' });
        const plugin = createPlugin(true);
        expect(() => plugin.onApplicationBootstrap()).not.toThrow();
    });

    it('throws in production when the issuer is public but plain HTTP', () => {
        process.env.NODE_ENV = 'production';
        setOauth({ tokenSecret: 'x', issuer: 'http://example.com' });
        expect(() => createPlugin(true).onApplicationBootstrap()).toThrow(/must use https in production/);
    });

    it('does not throw outside production when the issuer is plain HTTP', () => {
        process.env.NODE_ENV = 'development';
        setOauth({ tokenSecret: 'x', issuer: 'http://example.com' });
        expect(() => createPlugin(true).onApplicationBootstrap()).not.toThrow();
    });
});

describe('McpPlugin SDK schema preload', () => {
    let savedOptions: ResolvedMcpPluginOptions;

    beforeEach(() => {
        savedOptions = McpPlugin.options;
    });
    afterEach(() => {
        McpPlugin.options = savedOptions;
    });

    it('builds the MCP SDK wire schemas at bootstrap instead of on the first request', () => {
        McpPlugin.init({});
        vi.mocked(preloadSchemas).mockClear();
        new McpPlugin({ isServer: true } as ProcessContext, {} as I18nService).onApplicationBootstrap();
        expect(preloadSchemas).toHaveBeenCalledOnce();
    });
});

describe('McpPlugin logging options + retention task', () => {
    let savedOptions: ResolvedMcpPluginOptions;

    beforeEach(() => {
        savedOptions = McpPlugin.options;
    });
    afterEach(() => {
        McpPlugin.options = savedOptions;
    });

    it("applies logging defaults (ttlDays 30, capture 'metadata', 02:30 retention) when omitted", async () => {
        McpPlugin.init({});
        expect(McpPlugin.options.logging?.ttlDays).toBe(30);
        expect(McpPlugin.options.logging?.capture).toBe('metadata');
        const config = await runConfiguration();
        const task = config.schedulerOptions.tasks.find((t: any) => t.id === 'mcp-tool-call-log-retention');
        expect(task).toBeDefined();
        expect(resolveDayTime(task)).toBe('2:30');
    });

    it('registers the retention task with the configured schedule (configured wins over default)', async () => {
        McpPlugin.init({ logging: { retentionSchedule: cron => cron.everyDayAt(4, 15) } });
        const config = await runConfiguration();
        const task = config.schedulerOptions.tasks.find((t: any) => t.id === 'mcp-tool-call-log-retention');
        expect(resolveDayTime(task)).toBe('4:15');
    });

    it('accepts a plain cron-string schedule, like core does', async () => {
        McpPlugin.init({ logging: { retentionSchedule: '0 3 * * *' } });
        const config = await runConfiguration();
        const task = config.schedulerOptions.tasks.find((t: any) => t.id === 'mcp-tool-call-log-retention');
        expect(task.options.schedule).toBe('0 3 * * *');
    });

    it("honours a custom ttlDays and capture: 'full'", () => {
        McpPlugin.init({ logging: { ttlDays: 7, capture: 'full' } });
        expect(McpPlugin.options.logging?.ttlDays).toBe(7);
        expect(McpPlugin.options.logging?.capture).toBe('full');
    });

    it("warns at bootstrap when capture is 'full' without a redact function", () => {
        McpPlugin.init({ logging: { capture: 'full' } });
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        new McpPlugin({ isServer: true } as ProcessContext, {} as I18nService).onApplicationBootstrap();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });

    it("does not warn when capture is 'full' with a redact function", () => {
        McpPlugin.init({ logging: { capture: 'full', redact: ({ input, output }) => ({ input, output }) } });
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        new McpPlugin({ isServer: true } as ProcessContext, {} as I18nService).onApplicationBootstrap();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('does not warn under the default metadata capture', () => {
        McpPlugin.init({});
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        new McpPlugin({ isServer: true } as ProcessContext, {} as I18nService).onApplicationBootstrap();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('warns in production when no dnsRebinding allowlist is configured', () => {
        McpPlugin.init({});
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        try {
            new McpPlugin({ isServer: true } as ProcessContext, {} as I18nService).onApplicationBootstrap();
            expect(warnSpy).toHaveBeenCalledOnce();
            expect(warnSpy.mock.calls[0][0]).toMatch(/dnsRebinding is not set/);
        } finally {
            warnSpy.mockRestore();
            process.env.NODE_ENV = previousNodeEnv;
        }
    });

    it('does not warn in production when an allowlist is configured', () => {
        McpPlugin.init({ dnsRebinding: { allowedHosts: ['shop.example.com'] } });
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        try {
            new McpPlugin({ isServer: true } as ProcessContext, {} as I18nService).onApplicationBootstrap();
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
            process.env.NODE_ENV = previousNodeEnv;
        }
    });
});

describe('McpPlugin OAuth retention task', () => {
    let savedOptions: ResolvedMcpPluginOptions;
    let savedSchedule: (typeof mcpOauthRetentionTask)['options']['schedule'];

    beforeEach(() => {
        savedOptions = McpPlugin.options;
        // `configure()` mutates the shared task instance, so a schedule set by one case would
        // otherwise leak into the next.
        savedSchedule = mcpOauthRetentionTask.options.schedule;
    });
    afterEach(() => {
        McpPlugin.options = savedOptions;
        mcpOauthRetentionTask.configure({ schedule: savedSchedule });
    });

    const oauthTask = (config: any) =>
        config.schedulerOptions.tasks.find((t: any) => t.id === 'mcp-oauth-retention');

    // 03:30 rather than 02:30, so the two sweeps do not run at the same time on every Vendure instance.
    it('registers the OAuth retention task at 03:30 when no schedule is given', async () => {
        McpPlugin.init({});
        const config = await runConfiguration();
        expect(oauthTask(config)).toBeDefined();
        expect(resolveDayTime(oauthTask(config))).toBe('3:30');
    });

    it('registers the OAuth retention task with the configured schedule', async () => {
        McpPlugin.init({
            oauth: { tokenSecret: 'x', retentionSchedule: cron => cron.everyDayAt(5, 45) },
        });
        const config = await runConfiguration();
        expect(resolveDayTime(oauthTask(config))).toBe('5:45');
    });

    // The task owns the 03:30 default, so merging the OAuth defaults must not supply one.
    it('falls back to 03:30 when oauth is configured without a schedule', async () => {
        McpPlugin.init({ oauth: { tokenSecret: 'x' } });
        expect(McpPlugin.options.oauth?.retentionSchedule).toBeUndefined();
        expect(resolveDayTime(oauthTask(await runConfiguration()))).toBe('3:30');
    });

    it('resolves grantRetentionDays, defaulting to 30 days', () => {
        McpPlugin.init({ oauth: { tokenSecret: 'x' } });
        expect(McpPlugin.options.oauth?.grantRetentionDays).toBe(30);

        McpPlugin.init({ oauth: { tokenSecret: 'x', grantRetentionDays: 7 } });
        expect(McpPlugin.options.oauth?.grantRetentionDays).toBe(7);
    });

    // The sweep exists to bound tables that fill up whether or not OAuth was configured.
    it('registers the task even when oauth is not configured', async () => {
        McpPlugin.init({});
        expect(McpPlugin.options.oauth).toBeUndefined();
        expect(oauthTask(await runConfiguration())).toBeDefined();
    });
});

import { MiddlewareConsumer, NestModule, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import express from 'express';
import path from 'path';

import { GoogleAuthenticationStrategy } from './google-authentication-strategy';

export type GoogleAuthPluginOptions = {
    clientId: string;
};

/**
 * An demo implementation of a Google login flow.
 *
 * To run this you'll need to install `google-auth-library` from npm.
 *
 * Then add this plugin to the dev config.
 *
 * The "storefront" is a simple html file which is served on http://localhost:3000/google-login,
 * but to get it to work with the Google login button you'll need to resolve it to some
 * public-looking url such as `http://google-login-test.com` by modifying your OS
 * hosts file.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.authOptions.shopAuthenticationStrategy = [
            ...config.authOptions.shopAuthenticationStrategy,
            new GoogleAuthenticationStrategy(GoogleAuthPlugin.options.clientId),
        ];
        return config;
    },
})
export class GoogleAuthPlugin implements NestModule {
    static options: GoogleAuthPluginOptions;

    static init(options: GoogleAuthPluginOptions) {
        this.options = options;
        return GoogleAuthPlugin;
    }

    configure(consumer: MiddlewareConsumer) {
        consumer.apply(express.static(path.join(__dirname, 'public'))).forRoutes('google-login');
    }
}

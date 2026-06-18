import { HttpModule } from '@nestjs/axios';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import express from 'express';
import path from 'path';

import { KeycloakAuthenticationStrategy } from './keycloak-authentication-strategy';

/**
 * A demo plugin which configures an AuthenticationStrategy for a KeyCloak ID server.
 *
 * Assumes that KeyCloak is running on port 9000, with a realm configured named "myrealm"
 * and a client named "vendure".
 *
 * Add the plugin to the VendureConfig and set the Admin UI `loginUrl` option to
 * "http://localhost:3000/keycloak-login".
 *
 * Video demo of this: https://youtu.be/Tj4kwjNd2nM
 */
@VendurePlugin({
    imports: [PluginCommonModule, HttpModule],
    configuration: config => {
        config.authOptions.adminAuthenticationStrategy = [
            ...config.authOptions.adminAuthenticationStrategy,
            new KeycloakAuthenticationStrategy(),
        ];
        return config;
    },
})
export class KeycloakAuthPlugin implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(express.static(path.join(__dirname, 'public'))).forRoutes('keycloak-login');
    }
}

import {
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    Param,
    Post,
    Query,
    Res,
    UseFilters,
    UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import {
    McpOauthRateLimitExceptionFilter,
    McpOauthRateLimitGuard,
} from '../rate-limit/mcp-oauth-rate-limit.guard';

import { OAUTH_ENDPOINT_PATHS } from './endpoint-paths';
import { McpOauthExceptionFilter, parseOAuthInput } from './oauth-error';
import { McpOauthMetadataService } from './oauth-metadata.service';
import { authorizeInputSchema, registerClientInputSchema, tokenInputSchema } from './oauth-types';
import { McpOauthService } from './oauth.service';

@UseGuards(McpOauthRateLimitGuard)
@UseFilters(new McpOauthRateLimitExceptionFilter(), new McpOauthExceptionFilter())
@Controller()
export class McpOauthController {
    constructor(
        private oauthService: McpOauthService,
        private oauthMetadata: McpOauthMetadataService,
    ) {}

    @Get('.well-known/oauth-authorization-server')
    metadata() {
        return this.oauthMetadata.metadata();
    }

    @Get('.well-known/oauth-protected-resource/mcp/:endpoint')
    protectedResourceMetadata(@Param('endpoint') endpoint: string) {
        return this.oauthMetadata.protectedResourceMetadata(endpoint);
    }

    // Every route below either carries or accepts a credential, so none of them may be cached
    // (RFC 6749 section 5.1). The two metadata documents above are public and stay cacheable.
    @Post(OAUTH_ENDPOINT_PATHS.register)
    @Header('Cache-Control', 'no-store')
    @Header('Pragma', 'no-cache')
    register(@Body() body: unknown) {
        const input = parseOAuthInput(registerClientInputSchema, body, 'invalid_client_metadata');
        return this.oauthService.registerClient(input);
    }

    @Get(OAUTH_ENDPOINT_PATHS.authorize)
    @Header('Cache-Control', 'no-store')
    @Header('Pragma', 'no-cache')
    async authorize(@Query() query: unknown, @Res() res: Response): Promise<void> {
        const input = parseOAuthInput(authorizeInputSchema, query, 'invalid_request');
        const redirectUrl = await this.oauthService.createAuthorizationRedirect(input);
        res.redirect(redirectUrl);
    }

    @Get(OAUTH_ENDPOINT_PATHS.authorizationRequest)
    @Header('Cache-Control', 'no-store')
    @Header('Pragma', 'no-cache')
    authorizationRequest(@Query('request_token') requestToken: unknown) {
        const token = parseOAuthInput(z.string().optional(), requestToken, 'invalid_request');
        return this.oauthService.getAuthorizationRequestInfo(token);
    }

    // RFC 6749 §5.1 requires the token endpoint to respond with 200; override the NestJS
    // @Post default of 201.
    @Post(OAUTH_ENDPOINT_PATHS.token)
    @HttpCode(200)
    @Header('Cache-Control', 'no-store')
    @Header('Pragma', 'no-cache')
    token(@Body() body: unknown) {
        const input = parseOAuthInput(tokenInputSchema, body, 'invalid_request');
        return this.oauthService.exchangeToken(input);
    }

    @Post(OAUTH_ENDPOINT_PATHS.revoke)
    @HttpCode(200)
    @Header('Cache-Control', 'no-store')
    @Header('Pragma', 'no-cache')
    revoke(@Body() body: unknown) {
        // RFC 7009 §2.2 leaves revocation no way to report a bad token, so a token that is not
        // a string is treated as no token at all and the route still answers 200.
        const token = (body as { token?: unknown } | null | undefined)?.token;
        return this.oauthService.revoke(typeof token === 'string' ? token : undefined);
    }
}

import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    Res,
    UseFilters,
    UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { OAUTH_ENDPOINT_PATHS } from '../constants';
import {
    McpOauthRateLimitExceptionFilter,
    McpOauthRateLimitGuard,
} from '../rate-limit/mcp-oauth-rate-limit.guard';

import { AuthorizeInput, RegisterClientInput, TokenInput } from './oauth-types';
import { McpOauthService } from './oauth.service';

// One shared per-IP rate limit for every route here, current and future. The filter answers
// over-budget requests before Vendure's app-wide exception filter can rewrite the 429 body.
@UseGuards(McpOauthRateLimitGuard)
@UseFilters(new McpOauthRateLimitExceptionFilter())
@Controller()
export class McpOauthController {
    constructor(private oauthService: McpOauthService) {}

    @Get('.well-known/oauth-authorization-server')
    metadata() {
        return this.oauthService.metadata();
    }

    @Get('.well-known/oauth-protected-resource/mcp/:endpoint')
    protectedResourceMetadata(@Param('endpoint') endpoint: string) {
        return this.oauthService.protectedResourceMetadata(endpoint);
    }

    @Post(OAUTH_ENDPOINT_PATHS.register)
    register(@Body() input: RegisterClientInput) {
        return this.oauthService.registerClient(input);
    }

    @Get(OAUTH_ENDPOINT_PATHS.authorize)
    async authorize(@Query() input: AuthorizeInput, @Res() res: Response): Promise<void> {
        const redirectUrl = await this.oauthService.createAuthorizationRedirect(input);
        res.redirect(redirectUrl);
    }

    @Get('mcp/oauth/authorization-request')
    authorizationRequest(@Query('request_token') requestToken: string) {
        return this.oauthService.getAuthorizationRequestInfo(requestToken);
    }

    // RFC 6749 §5.1 requires the token endpoint to respond with 200; override the NestJS
    // @Post default of 201.
    @Post(OAUTH_ENDPOINT_PATHS.token)
    @HttpCode(200)
    token(@Body() input: TokenInput) {
        return this.oauthService.exchangeToken(input);
    }

    @Post(OAUTH_ENDPOINT_PATHS.revoke)
    @HttpCode(200)
    revoke(@Body('token') token?: string) {
        return this.oauthService.revoke(token);
    }
}

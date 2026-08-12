import { Injectable } from '@nestjs/common';
import { AssetService, ConfigService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { uploadAssetFromUrl } from '../remote-asset';

const uploadAssetInput = z.strictObject({
    url: z.string().describe('Public HTTP(S) URL of the asset to fetch and store.'),
});

type UploadAssetInput = z.infer<typeof uploadAssetInput>;

@McpTool({
    name: 'upload_asset',
    toolset: 'admin',
    description: 'Upload an asset from a publicly reachable HTTP(S) URL.',
    keywords: [
        'upload an image',
        'add a photo from a link',
        'import media from a url',
        'upload a picture to the library',
        'pull in a file from the web',
        'add an asset from a web address',
    ],
    permissions: [Permission.CreateAsset],
    inputSchema: uploadAssetInput,
})
@Injectable()
export class UploadAssetTool implements McpToolHandler<UploadAssetInput> {
    constructor(
        private assetService: AssetService,
        private configService: ConfigService,
    ) {}

    async execute(ctx: RequestContext, input: UploadAssetInput) {
        return {
            asset: await uploadAssetFromUrl(
                ctx,
                input.url,
                this.assetService,
                this.configService.importExportOptions.assetImportStrategy,
            ),
        };
    }
}

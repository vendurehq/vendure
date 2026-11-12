import { Injectable } from '@nestjs/common';
import { AssetEvent, AssetService, ConfigService, EventBus, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { uploadAssetFromUrl } from '../remote-asset';
import { McpToolSerializerService } from '../serializer.service';

const uploadAssetInput = z.strictObject({
    url: z.string().max(2048).describe('Public HTTP(S) URL of the asset to fetch and store.'),
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
    behavior: 'mutating',
    inputSchema: uploadAssetInput,
})
@Injectable()
export class UploadAssetTool implements McpToolHandler<UploadAssetInput> {
    constructor(
        private readonly assetService: AssetService,
        private readonly configService: ConfigService,
        private readonly eventBus: EventBus,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UploadAssetInput) {
        const asset = await uploadAssetFromUrl(
            ctx,
            input.url,
            this.assetService,
            this.configService.importExportOptions.assetImportStrategy,
        );
        // createFromFileStream() is meant for data import and publishes no event, so the tool publishes
        // the one AssetService.create() does for the createAssets mutation. See #5661
        await this.eventBus.publish(new AssetEvent(ctx, asset, 'created'));
        return { asset: this.serializer.asset(asset) };
    }
}

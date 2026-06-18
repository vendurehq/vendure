import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The AssetNamingStrategy determines how file names are generated based on the uploaded source file name,
 * as well as how to handle naming conflicts.
 *
 * :::info
 *
 * This is configured via the `assetOptions.assetNamingStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory assets
 */
export interface AssetNamingStrategy extends InjectableStrategy {
    /**
     * @description
     * Given the original file name of the uploaded file, generate a file name to
     * be stored on the server. Operations like normalization and time-stamping can
     * be performed in this method.
     *
     * The output will be checked for a naming conflict with an existing file. If a conflict
     * exists, this method will be invoked again with the second argument passed in and a new, unique
     * file name should then be generated. This process will repeat until a unique file name has
     * been returned.
     */
    generateSourceFileName(ctx: RequestContext, originalFileName: string, conflictFileName?: string): string;

    /**
     * @description
     * Given the source file name generated in the `generateSourceFileName` method, this method
     * should generate the file name of the preview image.
     *
     * The same mechanism of checking for conflicts is used as described above.
     */
    generatePreviewFileName(ctx: RequestContext, sourceFileName: string, conflictFileName?: string): string;
}

# Asset serving and storage problems

Applies to: Vendure 3.x with `@vendure/asset-server-plugin`. The `format`
query parameter needs v1.7.0 or later. The `q` parameter needs v2.2.0 or
later.

## Symptoms

- Asset URLs in API responses point to the wrong host, protocol or path.
- Images return 404 or do not load in the storefront or the Dashboard.
- Uploads fail, or previews are missing.
- With S3-compatible storage: `Access Denied`, `Bucket Not Found`, or
  connection timeouts.
- Assets uploaded on one instance are missing on another instance.

## Checks

1. **Plugin present.** The context inventory lists
   `@vendure/asset-server-plugin`, and the config `plugins` array has
   `AssetServerPlugin.init(...)`. Read the `route` option. Assets are served
   under that route, for example `/assets`.
   Doc: `reference/core-plugins/asset-server-plugin`
2. **assetUrlPrefix.** If `assetUrlPrefix` is not set, the plugin guesses the
   prefix from the request and the route. Behind a proxy or a CDN, the guess
   is often wrong.
   Doc: `reference/core-plugins/asset-server-plugin/asset-server-options#asseturlprefix`
3. **Storage strategy.** Find `storageStrategyFactory` in the plugin options.
   Without it, the plugin uses local storage in `assetUploadDir`. Local disk
   storage is not shared between instances or containers.
   Doc: `reference/core-plugins/asset-server-plugin/local-asset-storage-strategy`,
   `reference/core-plugins/asset-server-plugin/s3asset-storage-strategy`
4. **Production profile.** Run
   `vendure doctor --profile production --check project config`. It warns
   `No asset storage strategy configured` and
   `No asset preview strategy configured`.
5. **S3-compatible storage.** Ask the user to check bucket name, region,
   endpoint, path style and key permissions. Do not read the values yourself.
   Doc: `how-to/s3-asset-storage#troubleshooting`
6. **Image transforms.** Check the query parameters (`w`, `h`, `mode`,
   `preset`, `format`, `q`) against the plugin docs.
   Doc: `reference/core-plugins/asset-server-plugin#image-transformation`

## Remedies

| Cause                                    | Remedy                                                   | Reference                                                                        |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Wrong URLs behind a proxy or CDN         | Set `assetUrlPrefix` to the public asset URL             | `reference/core-plugins/asset-server-plugin/asset-server-options#asseturlprefix` |
| Assets lost between instances or deploys | Use S3-compatible storage with `configureS3AssetStorage` | `how-to/s3-asset-storage#vendure-configuration`                                  |
| S3 access, bucket or timeout errors      | Follow the S3 troubleshooting list                       | `how-to/s3-asset-storage#troubleshooting`                                        |
| No storage or preview strategy           | Add `AssetServerPlugin` with a storage strategy          | `core-concepts/images-assets#assetserverplugin`                                  |
| Unsupported transform parameter          | Use the documented parameters and presets                | `reference/core-plugins/asset-server-plugin#image-transformation`                |

All references are paths under `https://docs.vendure.io/current/core/`.

## 3.1.0-next.3 (2024-10-04)

This release includes all fixes from v3.0.4, as well as the following new features:

#### Features

* **core** Enhance AuthOptions.sessionCacheTTL by allowing string expressions (zeit/ms) (#3088)

## 3.1.0-next.2 (2024-09-11)

#### Fixes

* **core** Fix regression in correctly setting OrderLine.featuredAsset ([7d070f2](https://github.com/vendure-ecommerce/vendure/commit/7d070f2))
* **core** Fix error in FacetValueChecker on nullish input ([44aad49](https://github.com/vendure-ecommerce/vendure/commit/44aad49))


## 3.1.0-next.1 (2024-09-10)


#### Features

* **core** Implement CacheStrategy and CacheService ([489c9c0](https://github.com/vendure-ecommerce/vendure/commit/489c9c0)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Implement caching for FacetValueChecker ([3603b11](https://github.com/vendure-ecommerce/vendure/commit/3603b11)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Initial DefaultCachePlugin implementation ([9c2433f](https://github.com/vendure-ecommerce/vendure/commit/9c2433f)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)

#### Fixes

* **admin-ui** Only update facetValueIds if changed ([8f22ef8](https://github.com/vendure-ecommerce/vendure/commit/8f22ef8))


### BREAKING CHANGE
* If you are using the `FacetValueChecker` utility class, you should
  update your code to get it via the `Injector` rather than directly instantiating it.

Existing code _will_ still work without changes, but by updating you will see improved
performance due to new caching techniques.

```diff
- facetValueChecker = new FacetValueChecker(injector.get(TransactionalConnection));
+ facetValueChecker = injector.get(FacetValueChecker);
```

## 3.1.0-next.0 (2024-08-21)


#### Fixes

* **core** Update DefaultMoneyStrategy.round() Logic (#3023) ([f43c204](https://github.com/vendure-ecommerce/vendure/commit/f43c204)), closes [#3023](https://github.com/vendure-ecommerce/vendure/issues/3023)

#### Features

* **core** Add replicationMode for ctx and getRepository (#2746) ([60cdae3](https://github.com/vendure-ecommerce/vendure/commit/60cdae3)), closes [#2746](https://github.com/vendure-ecommerce/vendure/issues/2746)
* **core** Create a user from external authentication (#3005) ([bb28d70](https://github.com/vendure-ecommerce/vendure/commit/bb28d70)), closes [#3005](https://github.com/vendure-ecommerce/vendure/issues/3005)
* **core** Create PromotionLineAction (#2971) ([0ff8288](https://github.com/vendure-ecommerce/vendure/commit/0ff8288)), closes [#2971](https://github.com/vendure-ecommerce/vendure/issues/2971) [#2956](https://github.com/vendure-ecommerce/vendure/issues/2956)
* **email-plugin** Allow specifying metadata for EmailSendEvent (#2963) ([ac0baf9](https://github.com/vendure-ecommerce/vendure/commit/ac0baf9)), closes [#2963](https://github.com/vendure-ecommerce/vendure/issues/2963)


### BREAKING CHANGE

* A technically breaking change in this release is that we have corrected the default rounding logic:

```ts
// v3.0
return Math.round(value) * quantity;

// v3.1
return Math.round(value * quantity);
```

This makes order totals calculations much more "correct" as per most people's expectations, but it pointed out as a technically breaking change in the unlikely event that you rely on the old, less correct method of rounding.

## 2.2.0-next.8 (2024-04-04)


#### Fixes

* **core** Fix deleted product option groups can't be deleted again (#2706) ([16add4a](https://github.com/vendure-ecommerce/vendure/commit/16add4a)), closes [#2706](https://github.com/vendure-ecommerce/vendure/issues/2706)
* **core** Fix edge case with cached tax zone ([e543e5e](https://github.com/vendure-ecommerce/vendure/commit/e543e5e))
* **core** Fix error in joining list query relations ([33db45d](https://github.com/vendure-ecommerce/vendure/commit/33db45d))
* **core** Persist custom field relations on TaxRate ([7eaa641](https://github.com/vendure-ecommerce/vendure/commit/7eaa641))
* **core** Remove empty customFields relations from getMissingRelations in entity-hydrator (#2765) ([1c44113](https://github.com/vendure-ecommerce/vendure/commit/1c44113)), closes [#2765](https://github.com/vendure-ecommerce/vendure/issues/2765)
* **core** Wrap nextOrderStates in transaction ([ed9539d](https://github.com/vendure-ecommerce/vendure/commit/ed9539d))

#### Features

* **cli** Add API extension command ([41675a4](https://github.com/vendure-ecommerce/vendure/commit/41675a4))
* **cli** Add codegen command ([de5544c](https://github.com/vendure-ecommerce/vendure/commit/de5544c))
* **cli** Add job queue command ([2193a77](https://github.com/vendure-ecommerce/vendure/commit/2193a77))
* **cli** Add service command ([e29accc](https://github.com/vendure-ecommerce/vendure/commit/e29accc))
* **cli** Allow chaining features onto a newly-created plugin ([5b32c59](https://github.com/vendure-ecommerce/vendure/commit/5b32c59))
* **cli** Allow new entity features to be selected ([74c69dd](https://github.com/vendure-ecommerce/vendure/commit/74c69dd))
* **cli** Implement migrations in CLI ([9860abd](https://github.com/vendure-ecommerce/vendure/commit/9860abd))
* **core** Pass ctx to job queue strategy add (#2759) ([3909251](https://github.com/vendure-ecommerce/vendure/commit/3909251)), closes [#2759](https://github.com/vendure-ecommerce/vendure/issues/2759) [#2758](https://github.com/vendure-ecommerce/vendure/issues/2758)
* **create** Ship Vendure CLI with new projects ([faf69a9](https://github.com/vendure-ecommerce/vendure/commit/faf69a9))

## 2.2.0-next.7 (2024-03-20)


#### Perf

* **core** Database access performance & edge case fixes  (#2744) ([48b239b](https://github.com/vendure-ecommerce/vendure/commit/48b239b)), closes [#2744](https://github.com/vendure-ecommerce/vendure/issues/2744)
* **core** Optimization for assignToChannels method (#2743) ([c69e4ac](https://github.com/vendure-ecommerce/vendure/commit/c69e4ac)), closes [#2743](https://github.com/vendure-ecommerce/vendure/issues/2743)
* **core** Upgrade EntityHydrator performance to any hydrate call (#2742) ([77233cd](https://github.com/vendure-ecommerce/vendure/commit/77233cd)), closes [#2742](https://github.com/vendure-ecommerce/vendure/issues/2742)
* **core** Upgrade sql requests for more performant memory usage with big datasets (#2741) ([65888cb](https://github.com/vendure-ecommerce/vendure/commit/65888cb)), closes [#2741](https://github.com/vendure-ecommerce/vendure/issues/2741)

#### Features

* **admin-ui** Expose `registerAlert` provider for custom UI alerts ([698ea0c](https://github.com/vendure-ecommerce/vendure/commit/698ea0c)), closes [#2503](https://github.com/vendure-ecommerce/vendure/issues/2503)
* **core** Implement new blocking event handler API ([1c69499](https://github.com/vendure-ecommerce/vendure/commit/1c69499)), closes [#2735](https://github.com/vendure-ecommerce/vendure/issues/2735)

#### Fixes

* **admin-ui** Fix dark mode layout ([893a913](https://github.com/vendure-ecommerce/vendure/commit/893a913)), closes [#2745](https://github.com/vendure-ecommerce/vendure/issues/2745)
* **core** Fix self-referencing relations `Not unique table/alias` (#2740) ([357ba49](https://github.com/vendure-ecommerce/vendure/commit/357ba49)), closes [#2740](https://github.com/vendure-ecommerce/vendure/issues/2740) [#2738](https://github.com/vendure-ecommerce/vendure/issues/2738)

## 2.2.0-next.6 (2024-03-14)


#### Fixes

* **admin-ui** Fix alerts service registration ([04dcaab](https://github.com/vendure-ecommerce/vendure/commit/04dcaab))
* **core** Fix amount being sent to payment handler refund method ([b6a5691](https://github.com/vendure-ecommerce/vendure/commit/b6a5691))

#### Features

* **admin-ui** Update Angular to v17.2 ([6f6a7af](https://github.com/vendure-ecommerce/vendure/commit/6f6a7af))
* **admin-ui** Update Clarity UI library to v17 ([44cfd95](https://github.com/vendure-ecommerce/vendure/commit/44cfd95))
* **asset-server-plugin** Add `q` query param for dynamic quality ([b96289b](https://github.com/vendure-ecommerce/vendure/commit/b96289b))
* **asset-server-plugin** Update Sharp to v0.33.2 ([f3d45a0](https://github.com/vendure-ecommerce/vendure/commit/f3d45a0))
* **core** Export order state machine ([138d9ff](https://github.com/vendure-ecommerce/vendure/commit/138d9ff))
* **core** Update NestJS to latest version (v10.3.3) ([573ae18](https://github.com/vendure-ecommerce/vendure/commit/573ae18))
* **core** Update TypeORM to v0.3.20 ([0afc94e](https://github.com/vendure-ecommerce/vendure/commit/0afc94e))
* **payments-plugin** Prevent duplicate Mollie payments (#2691) ([34b61cd](https://github.com/vendure-ecommerce/vendure/commit/34b61cd)), closes [#2691](https://github.com/vendure-ecommerce/vendure/issues/2691)
* **ui-devkit** Add `prefix` option to route config to allow overrides ([babe4f4](https://github.com/vendure-ecommerce/vendure/commit/babe4f4)), closes [#2705](https://github.com/vendure-ecommerce/vendure/issues/2705)


### BREAKING CHANGE

* MolliePlugin - A new mollieOrderId has been added in order to prevent duplicate payments in Mollie. This will require a DB migration to add the custom field to your DB schema.
## 2.2.0-next.5 (2024-02-26)


#### Fixes

* **core** Correctly return custom field relation scalar fields ([1280cf3](https://github.com/vendure-ecommerce/vendure/commit/1280cf3))

## 2.2.0-next.4 (2024-02-26)


#### Fixes

* **admin-ui** Fix saving entities with custom field relations ([80f1f95](https://github.com/vendure-ecommerce/vendure/commit/80f1f95)) (this was a regression introduced in next.3)
* **core** Fix typing on ProductOptionGroupService.create() method ([8fe24da](https://github.com/vendure-ecommerce/vendure/commit/8fe24da)), closes [#2577](https://github.com/vendure-ecommerce/vendure/issues/2577)

#### Features

* **admin-ui** Add React RichTextEditor component & hook (#2675) ([68e0fa5](https://github.com/vendure-ecommerce/vendure/commit/68e0fa5)), closes [#2675](https://github.com/vendure-ecommerce/vendure/issues/2675)
* **admin-ui** Add support for custom action bar dropdown menus ([4d8bc74](https://github.com/vendure-ecommerce/vendure/commit/4d8bc74)), closes [#2678](https://github.com/vendure-ecommerce/vendure/issues/2678)
* **admin-ui** Add support for permissions on custom fields ([94e0c42](https://github.com/vendure-ecommerce/vendure/commit/94e0c42)), closes [#2671](https://github.com/vendure-ecommerce/vendure/issues/2671)
* **admin-ui** Channel aware picker ([fd92b4c](https://github.com/vendure-ecommerce/vendure/commit/fd92b4c))
* **admin-ui** Expose `entity$` observable on action bar context ([3f07179](https://github.com/vendure-ecommerce/vendure/commit/3f07179))
* **admin-ui** Implement UI for entity duplication ([7aa0d16](https://github.com/vendure-ecommerce/vendure/commit/7aa0d16)), closes [#627](https://github.com/vendure-ecommerce/vendure/issues/627)
* **cli** Allow new plugin dir to be specified ([4ae12e7](https://github.com/vendure-ecommerce/vendure/commit/4ae12e7))
* **cli** Implement "add entity" command ([ad87531](https://github.com/vendure-ecommerce/vendure/commit/ad87531))
* **cli** Implement "add" command for ui extensions ([795b013](https://github.com/vendure-ecommerce/vendure/commit/795b013))
* **core** Add support for permissions on custom fields ([1c9f8f9](https://github.com/vendure-ecommerce/vendure/commit/1c9f8f9)), closes [#2671](https://github.com/vendure-ecommerce/vendure/issues/2671)
* **core** Implement collection duplicator ([d457851](https://github.com/vendure-ecommerce/vendure/commit/d457851)), closes [#627](https://github.com/vendure-ecommerce/vendure/issues/627)
* **core** Implement facet duplicator ([8d20847](https://github.com/vendure-ecommerce/vendure/commit/8d20847)), closes [#627](https://github.com/vendure-ecommerce/vendure/issues/627)
* **core** Implement internal support for entity duplication ([477fe93](https://github.com/vendure-ecommerce/vendure/commit/477fe93)), closes [#627](https://github.com/vendure-ecommerce/vendure/issues/627)
* **core** Implement product duplicator ([6ac43d9](https://github.com/vendure-ecommerce/vendure/commit/6ac43d9)), closes [#627](https://github.com/vendure-ecommerce/vendure/issues/627)
* **core** Implement promotion duplicator ([da58b0b](https://github.com/vendure-ecommerce/vendure/commit/da58b0b)), closes [#627](https://github.com/vendure-ecommerce/vendure/issues/627)
* **core** Update TypeScript version to v5.1.6 ([2f51929](https://github.com/vendure-ecommerce/vendure/commit/2f51929))
* **email-plugin** Publish EmailSendEvent after send attempted ([e4175e7](https://github.com/vendure-ecommerce/vendure/commit/e4175e7))

## 2.2.0-next.3 (2024-02-14)


#### Features

* **admin-ui** Add bulk facet value editing to product variant list ([5ad41bf](https://github.com/vendure-ecommerce/vendure/commit/5ad41bf))
* **core** Introduce new `ProductVariantPriceEvent` ([aa4eeb8](https://github.com/vendure-ecommerce/vendure/commit/aa4eeb8))
* **core** Introduce new `ProductVariantPriceUpdateStrategy` ([9099f35](https://github.com/vendure-ecommerce/vendure/commit/9099f35)), closes [#2651](https://github.com/vendure-ecommerce/vendure/issues/2651)

## 2.2.0-next.2 (2024-02-07)


#### Fixes

* **admin-ui** Add missing RTL compatibility to some admin-ui components (#2451) ([96eb96e](https://github.com/vendure-ecommerce/vendure/commit/96eb96e)), closes [#2451](https://github.com/vendure-ecommerce/vendure/issues/2451)
* **admin-ui** Fix alignment of order modification history item ([e4a172c](https://github.com/vendure-ecommerce/vendure/commit/e4a172c))
* **admin-ui** Improve styling of form field wrapper ([5263c2d](https://github.com/vendure-ecommerce/vendure/commit/5263c2d))
* **admin-ui** Improved support for modifying OrderLine custom fields ([0750fb1](https://github.com/vendure-ecommerce/vendure/commit/0750fb1)), closes [#2641](https://github.com/vendure-ecommerce/vendure/issues/2641)
* **core** Fix undefined reference error in product variant resolver ([5afa6bc](https://github.com/vendure-ecommerce/vendure/commit/5afa6bc))

#### Features

* **admin-ui** Allow customer to be reassigned to order ([a9a596e](https://github.com/vendure-ecommerce/vendure/commit/a9a596e)), closes [#2505](https://github.com/vendure-ecommerce/vendure/issues/2505)
* **admin-ui** Allow order shipping method to be modified ([7f34329](https://github.com/vendure-ecommerce/vendure/commit/7f34329)), closes [#978](https://github.com/vendure-ecommerce/vendure/issues/978)
* **admin-ui** Enable multiple refunds on an order modification ([9b3aa65](https://github.com/vendure-ecommerce/vendure/commit/9b3aa65)), closes [#2393](https://github.com/vendure-ecommerce/vendure/issues/2393)
* **admin-ui** Improve layout & styling of order payment cards ([4a8b91a](https://github.com/vendure-ecommerce/vendure/commit/4a8b91a))
* **admin-ui** Improve styling of order/customer history timeline ([aeebbdd](https://github.com/vendure-ecommerce/vendure/commit/aeebbdd))
* **admin-ui** Improved refund dialog ([ccbf9ec](https://github.com/vendure-ecommerce/vendure/commit/ccbf9ec)), closes [#2393](https://github.com/vendure-ecommerce/vendure/issues/2393)
* **admin-ui** Support custom fields on custom entities ([74aeb86](https://github.com/vendure-ecommerce/vendure/commit/74aeb86)), closes [#1848](https://github.com/vendure-ecommerce/vendure/issues/1848)
* **admin-ui** Updated order modification screen with improved UX ([ac4c762](https://github.com/vendure-ecommerce/vendure/commit/ac4c762))
* **core** Add support for custom fields on ProductVariantPrice (#2654) ([e7f0fe2](https://github.com/vendure-ecommerce/vendure/commit/e7f0fe2)), closes [#2654](https://github.com/vendure-ecommerce/vendure/issues/2654)
* **core** Add `amount` field to `RefundOrderInput` ([fe43b4a](https://github.com/vendure-ecommerce/vendure/commit/fe43b4a)), closes [#2393](https://github.com/vendure-ecommerce/vendure/issues/2393)
* **core** Add `gracefulShutdownTimeout` to DefaultJobQueuePlugin ([cba06e0](https://github.com/vendure-ecommerce/vendure/commit/cba06e0))
* **core** Add cancellation handling to built-in jobs ([c8022be](https://github.com/vendure-ecommerce/vendure/commit/c8022be)), closes [#1127](https://github.com/vendure-ecommerce/vendure/issues/1127) [#2650](https://github.com/vendure-ecommerce/vendure/issues/2650)
* **core** Allow order shipping method to be modified ([400d78a](https://github.com/vendure-ecommerce/vendure/commit/400d78a)), closes [#978](https://github.com/vendure-ecommerce/vendure/issues/978)
* **core** Enable multiple refunds on an order modification ([cf91a9e](https://github.com/vendure-ecommerce/vendure/commit/cf91a9e)), closes [#2393](https://github.com/vendure-ecommerce/vendure/issues/2393)
* **core** Expose entityCustomFields query ([01f9d44](https://github.com/vendure-ecommerce/vendure/commit/01f9d44)), closes [#1848](https://github.com/vendure-ecommerce/vendure/issues/1848)
* **core** Implement `setOrderCustomer` mutation ([26e77d7](https://github.com/vendure-ecommerce/vendure/commit/26e77d7)), closes [#2505](https://github.com/vendure-ecommerce/vendure/issues/2505)
* **core** Improve cancellation mechanism of DefaultJobQueuePlugin ([cba069b](https://github.com/vendure-ecommerce/vendure/commit/cba069b)), closes [#1127](https://github.com/vendure-ecommerce/vendure/issues/1127) [#2650](https://github.com/vendure-ecommerce/vendure/issues/2650)
* **core** Introduce ErrorHandlerStrategy ([066e524](https://github.com/vendure-ecommerce/vendure/commit/066e524))
* **core** Pass RequestContext to custom field validate function ([2314ff6](https://github.com/vendure-ecommerce/vendure/commit/2314ff6)), closes [#2408](https://github.com/vendure-ecommerce/vendure/issues/2408)
* **job-queue-plugin** Implement cancellation mechanism in BullMQJobQueuePlugin ([d0e97ca](https://github.com/vendure-ecommerce/vendure/commit/d0e97ca)), closes [#1127](https://github.com/vendure-ecommerce/vendure/issues/1127) [#2650](https://github.com/vendure-ecommerce/vendure/issues/2650)
* **sentry-plugin** Use ErrorHandlerStrategy for better error coverage ([82ddf94](https://github.com/vendure-ecommerce/vendure/commit/82ddf94))

## 2.2.0-next.1 (2024-01-16)


#### Fixes

- Includes all fixes from v2.1.6

#### Features

* **admin-ui** Add support for Norwegian Bokmål (#2611) ([00d5315](https://github.com/vendure-ecommerce/vendure/commit/00d5315)), closes [#2611](https://github.com/vendure-ecommerce/vendure/issues/2611)
* **admin-ui** Product & variant lists can be filtered by name & sku ([74293cb](https://github.com/vendure-ecommerce/vendure/commit/74293cb)), closes [#2519](https://github.com/vendure-ecommerce/vendure/issues/2519)
* **core** Add `precision` property to MoneyStrategy ([c33ba63](https://github.com/vendure-ecommerce/vendure/commit/c33ba63))
* **core** Add SKU filtering to `products` list in Admin API ([876d1ec](https://github.com/vendure-ecommerce/vendure/commit/876d1ec)), closes [#2519](https://github.com/vendure-ecommerce/vendure/issues/2519)
* **core** Expose `enabled` field for Product in shop api (#2541) ([f6f2975](https://github.com/vendure-ecommerce/vendure/commit/f6f2975)), closes [#2541](https://github.com/vendure-ecommerce/vendure/issues/2541)
* **core** Expose additional bootstrap options (#2568) ([3b6d6ab](https://github.com/vendure-ecommerce/vendure/commit/3b6d6ab)), closes [#2568](https://github.com/vendure-ecommerce/vendure/issues/2568)
* **core** Implement complex boolean list filtering for PaginatedLists ([c4bd484](https://github.com/vendure-ecommerce/vendure/commit/c4bd484)), closes [#2594](https://github.com/vendure-ecommerce/vendure/issues/2594)

## 2.2.0-next.0 (2023-12-14)


#### Fixes

* **email-plugin** Remove unwanted currency symbols in template (#2536) ([639fa0f](https://github.com/vendure-ecommerce/vendure/commit/639fa0f)), closes [#2536](https://github.com/vendure-ecommerce/vendure/issues/2536)
* **ui-devkit** Add call to exit in sigint handler (#2558) ([bfd9281](https://github.com/vendure-ecommerce/vendure/commit/bfd9281)), closes [#2558](https://github.com/vendure-ecommerce/vendure/issues/2558)

#### Features

* **admin-ui** Add React useLazyQuery hook (#2498) ([757635b](https://github.com/vendure-ecommerce/vendure/commit/757635b)), closes [#2498](https://github.com/vendure-ecommerce/vendure/issues/2498)
* **admin-ui** Allow configuration of available locales (#2550) ([dfddf0f](https://github.com/vendure-ecommerce/vendure/commit/dfddf0f)), closes [#2550](https://github.com/vendure-ecommerce/vendure/issues/2550)
* **core** Accept `maxAge` and `expires` options in cookie config ([c903388](https://github.com/vendure-ecommerce/vendure/commit/c903388)), closes [#2518](https://github.com/vendure-ecommerce/vendure/issues/2518)
* **core** Add Missing inherit filters field in collection import (#2534) ([ef64db7](https://github.com/vendure-ecommerce/vendure/commit/ef64db7)), closes [#2534](https://github.com/vendure-ecommerce/vendure/issues/2534) [#2484](https://github.com/vendure-ecommerce/vendure/issues/2484)
* **core** Enable setting different cookie name for Shop & Admin API (#2482) ([ae91650](https://github.com/vendure-ecommerce/vendure/commit/ae91650)), closes [#2482](https://github.com/vendure-ecommerce/vendure/issues/2482)
* **elasticsearch-plugin** Provide the ctx for custom mappings (#2547) ([c5d0ea2](https://github.com/vendure-ecommerce/vendure/commit/c5d0ea2)), closes [#2547](https://github.com/vendure-ecommerce/vendure/issues/2547)
* **email-plugin** Multiple currency support in formatMoney helper (#2531) ([ccf17fb](https://github.com/vendure-ecommerce/vendure/commit/ccf17fb)), closes [#2531](https://github.com/vendure-ecommerce/vendure/issues/2531)
* **job-queue-plugin** Improve pub/sub message handling (#2561) ([3645819](https://github.com/vendure-ecommerce/vendure/commit/3645819)), closes [#2561](https://github.com/vendure-ecommerce/vendure/issues/2561)
* **payments-plugin** Mollie: support extra parameters for listing methods (#2516) ([cb9846b](https://github.com/vendure-ecommerce/vendure/commit/cb9846b)), closes [#2516](https://github.com/vendure-ecommerce/vendure/issues/2516) [#2510](https://github.com/vendure-ecommerce/vendure/issues/2510)

## 2.1.0-next.7 (2023-09-29)

#### Features

* **admin-ui** Add Persian/Farsi i18n messages (#2418) ([1193863](https://github.com/vendure-ecommerce/vendure/commit/1193863)), closes [#2418](https://github.com/vendure-ecommerce/vendure/issues/2418)

#### Fixes

* **core** Fix discount calculation error edge-case ([7549aad](https://github.com/vendure-ecommerce/vendure/commit/7549aad)), closes [#2385](https://github.com/vendure-ecommerce/vendure/issues/2385)

## 2.1.0-next.6 (2023-09-27)


#### Features

* **admin-ui** Add filter preset support to Collection list ([cbfb402](https://github.com/vendure-ecommerce/vendure/commit/cbfb402))
* **admin-ui** Display original quantity after order has been modified ([a36c6e0](https://github.com/vendure-ecommerce/vendure/commit/a36c6e0))
* **admin-ui** Implement job queue filtering by status ([baeb036](https://github.com/vendure-ecommerce/vendure/commit/baeb036))
* **admin-ui** Implement values pagination for Facet detail view ([4cf1826](https://github.com/vendure-ecommerce/vendure/commit/4cf1826)), closes [#1257](https://github.com/vendure-ecommerce/vendure/issues/1257)
* **admin-ui** Improve naming & layout of catalog & stock locations ([8452300](https://github.com/vendure-ecommerce/vendure/commit/8452300))
* **core** Pass variant to ProductVariantPriceCalculationStrategy ([fee995c](https://github.com/vendure-ecommerce/vendure/commit/fee995c)), closes [#2398](https://github.com/vendure-ecommerce/vendure/issues/2398)
* **create** Allow selection of package manager ([6561bb7](https://github.com/vendure-ecommerce/vendure/commit/6561bb7))
* **job-queue-plugin** Implement default cleanup of old BullMQ jobs ([6c1d7bb](https://github.com/vendure-ecommerce/vendure/commit/6c1d7bb)), closes [#1425](https://github.com/vendure-ecommerce/vendure/issues/1425)
* **payments-plugin** Allow custom params to be passed to Stripe API ([1b29097](https://github.com/vendure-ecommerce/vendure/commit/1b29097)), closes [#2412](https://github.com/vendure-ecommerce/vendure/issues/2412)

#### Fixes

* **admin-ui** Correctly display job retries ([d3107fd](https://github.com/vendure-ecommerce/vendure/commit/d3107fd)), closes [#1467](https://github.com/vendure-ecommerce/vendure/issues/1467)
* **job-queue-plugin** Correct behaviour of job list query with BullMQ ([c148a92](https://github.com/vendure-ecommerce/vendure/commit/c148a92)), closes [#2120](https://github.com/vendure-ecommerce/vendure/issues/2120) [#1327](https://github.com/vendure-ecommerce/vendure/issues/1327)
* **job-queue-plugin** Correct retry setting for BullMQ jobs ([972ba0e](https://github.com/vendure-ecommerce/vendure/commit/972ba0e)), closes [#1467](https://github.com/vendure-ecommerce/vendure/issues/1467)


### BREAKING CHANGE

* In the Admin UI, the "stock locations" list and detail views
have been moved from the "catalog" module to the "settings" module. Also, the
menu item & breadcrumb for "inventory" has been renamed to "products".

  This is an end-user breaking change rather than a code breaking change. Any UI
extensions that link to a `/catalog/inventory/...` route will still work as there
is a redirect in place to `/catalog/products/...`.
## 2.1.0-next.5 (2023-09-18)


#### Features

* **admin-ui** Add image carousel to asset preview dialog (#2370) ([bd834d0](https://github.com/vendure-ecommerce/vendure/commit/bd834d0)), closes [#2370](https://github.com/vendure-ecommerce/vendure/issues/2370) [#2129](https://github.com/vendure-ecommerce/vendure/issues/2129)
* **admin-ui** Add more native React UI components ([04e03f8](https://github.com/vendure-ecommerce/vendure/commit/04e03f8))
* **admin-ui** Add useRouteParams react hook ([b63fb7f](https://github.com/vendure-ecommerce/vendure/commit/b63fb7f))
* **admin-ui** Expose providers to nav menu routerLink function ([1bae40e](https://github.com/vendure-ecommerce/vendure/commit/1bae40e))
* **admin-ui** Improved control over ActionBar buttons ([065a2b4](https://github.com/vendure-ecommerce/vendure/commit/065a2b4))
* **create** Better defaults for project scaffold ([fa683e7](https://github.com/vendure-ecommerce/vendure/commit/fa683e7))
* **cli** Introduce new `@vendure/cli` package which exposes a `vendure` binary. Currently supports `vendure new plugin` command.
* **cli** Implement plugin scaffold command ([a6df4c1](https://github.com/vendure-ecommerce/vendure/commit/a6df4c1))
* **cli** Include custom CRUD permissions with plugin scaffold ([0c62b6f](https://github.com/vendure-ecommerce/vendure/commit/0c62b6f))

#### Fixes

* **admin-ui** Fix component for new Angular extension route API ([6fe1bd0](https://github.com/vendure-ecommerce/vendure/commit/6fe1bd0))
* **admin-ui** Fix creating nullable string fields ([7e2c17a](https://github.com/vendure-ecommerce/vendure/commit/7e2c17a)), closes [#2343](https://github.com/vendure-ecommerce/vendure/issues/2343)
* **core** Export EntityId and Money decorators ([4664dee](https://github.com/vendure-ecommerce/vendure/commit/4664dee))

## 2.1.0-next.4 (2023-09-08)


#### Fixes

* **ui-devkit** Fix scaffold logic for custom providers ([2f2ddb5](https://github.com/vendure-ecommerce/vendure/commit/2f2ddb5))

## 2.1.0-next.3 (2023-09-08)


#### Fixes

* **admin-ui** Add custom field support to Customer list ([97ba022](https://github.com/vendure-ecommerce/vendure/commit/97ba022))
* **admin-ui** Fix channel switcher icon style ([7f30361](https://github.com/vendure-ecommerce/vendure/commit/7f30361))
* **admin-ui** Fix error when data table filters not defined ([2425a33](https://github.com/vendure-ecommerce/vendure/commit/2425a33))
* **admin-ui** Fix styling of custom field tabs ([57f47df](https://github.com/vendure-ecommerce/vendure/commit/57f47df))
* **admin-ui** Give all data table columns immutable ids ([73a78db](https://github.com/vendure-ecommerce/vendure/commit/73a78db))
* **admin-ui** Use correct defaults for nullable custom fields (#2360) ([88430e5](https://github.com/vendure-ecommerce/vendure/commit/88430e5)), closes [#2360](https://github.com/vendure-ecommerce/vendure/issues/2360)
* **core** Downgrade ForbiddenError from Error to Warn log level ([c186392](https://github.com/vendure-ecommerce/vendure/commit/c186392)), closes [#2383](https://github.com/vendure-ecommerce/vendure/issues/2383)
* **core** Fix channel association on promotion update (#2376) ([e1ff2c7](https://github.com/vendure-ecommerce/vendure/commit/e1ff2c7)), closes [#2376](https://github.com/vendure-ecommerce/vendure/issues/2376)

#### Features

* **admin-ui** Add initial React support for UI extensions ([1075dd7](https://github.com/vendure-ecommerce/vendure/commit/1075dd7))
* **admin-ui** Allow custom components in data table columns ([d3474dd](https://github.com/vendure-ecommerce/vendure/commit/d3474dd)), closes [#2347](https://github.com/vendure-ecommerce/vendure/issues/2347) [#2353](https://github.com/vendure-ecommerce/vendure/issues/2353)
* **admin-ui** Allow custom React components in data table columns ([5cde775](https://github.com/vendure-ecommerce/vendure/commit/5cde775)), closes [#2347](https://github.com/vendure-ecommerce/vendure/issues/2347) [#2353](https://github.com/vendure-ecommerce/vendure/issues/2353)
* **admin-ui** Implement custom components in Collection data table ([4ab7c1e](https://github.com/vendure-ecommerce/vendure/commit/4ab7c1e))
* **admin-ui** Implement react Card component ([c588a1f](https://github.com/vendure-ecommerce/vendure/commit/c588a1f))
* **admin-ui** Implement simplified API for UI route extensions ([b9ca367](https://github.com/vendure-ecommerce/vendure/commit/b9ca367))
* **admin-ui** Improve dev mode extension point display ([4678930](https://github.com/vendure-ecommerce/vendure/commit/4678930))
* **admin-ui** Initial support for React UI extensions ([83d5756](https://github.com/vendure-ecommerce/vendure/commit/83d5756))
* **admin-ui** Style improvements to table and form input borders ([5287287](https://github.com/vendure-ecommerce/vendure/commit/5287287))
* **admin-ui** Support for React-based custom detail components ([55d9ffc](https://github.com/vendure-ecommerce/vendure/commit/55d9ffc))
* **core** Support bi-directional relations in customFields (#2365) ([0313ce5](https://github.com/vendure-ecommerce/vendure/commit/0313ce5)), closes [#2365](https://github.com/vendure-ecommerce/vendure/issues/2365)
* **ui-devkit** Add experimental wrapper for shared ui providers ([daf6f8c](https://github.com/vendure-ecommerce/vendure/commit/daf6f8c))

## 2.1.0-next.2 (2023-08-28)


#### Fixes

* **core** Fix resolution of facet valueList for postgres ([1d8fe47](https://github.com/vendure-ecommerce/vendure/commit/1d8fe47))

## 2.1.0-next.1 (2023-08-28)


#### Fixes

* **admin-ui** Correct handling of ID filters in data tables ([0e05496](https://github.com/vendure-ecommerce/vendure/commit/0e05496))
* **admin-ui** Data table filters react to page navigation ([39832bd](https://github.com/vendure-ecommerce/vendure/commit/39832bd))
* **core** Fix circular dependency issue in SQLiteSearchStrategy ([f2e2e32](https://github.com/vendure-ecommerce/vendure/commit/f2e2e32))

#### Features

* **admin-ui** Add data table filter presets functionality ([a656ef2](https://github.com/vendure-ecommerce/vendure/commit/a656ef2))
* **admin-ui** Implement drag-and-drop reorder of filter presets ([8e06705](https://github.com/vendure-ecommerce/vendure/commit/8e06705))
* **admin-ui** Implement filter preset renaming ([8b52e6f](https://github.com/vendure-ecommerce/vendure/commit/8b52e6f))
* **admin-ui** Implement relative date filtering ([d07a5f3](https://github.com/vendure-ecommerce/vendure/commit/d07a5f3))
* **admin-ui** Update to Angular v16.2 ([608d5d3](https://github.com/vendure-ecommerce/vendure/commit/608d5d3))
* **core** Update NestJS to v10, Apollo Server v4 ([b675fda](https://github.com/vendure-ecommerce/vendure/commit/b675fda))


### BREAKING CHANGE

* The update of Apollo Server to v4 includes some breaking changes if you have
defined any custom ApolloServerPlugins. See the Apollo migration guide for full details:
https://www.apollographql.com/docs/apollo-server/migration/
## 2.1.0-next.0 (2023-08-11)

Includes all changes from v2.0.6, plus:

#### Features

* **admin-ui** Admin UI rtl with Arabic translation improvements (#2322) ([44ea12b](https://github.com/vendure-ecommerce/vendure/commit/44ea12b)), closes [#2322](https://github.com/vendure-ecommerce/vendure/issues/2322)
* **core** Add `Facet.valueList` resolver for paginated values ([09c7175](https://github.com/vendure-ecommerce/vendure/commit/09c7175)), closes [#1257](https://github.com/vendure-ecommerce/vendure/issues/1257)
* **core** Add maximum coupon usage (#2331) ([bdd2720](https://github.com/vendure-ecommerce/vendure/commit/bdd2720)), closes [#2331](https://github.com/vendure-ecommerce/vendure/issues/2331) [#2330](https://github.com/vendure-ecommerce/vendure/issues/2330)
* **email-plugin** Expose template vars to template loader (#2243) ([78ea016](https://github.com/vendure-ecommerce/vendure/commit/78ea016)), closes [#2243](https://github.com/vendure-ecommerce/vendure/issues/2243) [#2242](https://github.com/vendure-ecommerce/vendure/issues/2242)

#### Fixes

* **admin-ui** Improve RTL styles ([056d205](https://github.com/vendure-ecommerce/vendure/commit/056d205))
* **admin-ui** Limit FacetValues in Facet list component ([b445955](https://github.com/vendure-ecommerce/vendure/commit/b445955)), closes [#1257](https://github.com/vendure-ecommerce/vendure/issues/1257)


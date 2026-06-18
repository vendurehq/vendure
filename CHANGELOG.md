## <small>3.6.4 (2026-06-01)</small>


#### Fixes

* **core** Block SSRF in DefaultAssetImportStrategy (#4721) ([196fd7b](https://github.com/vendurehq/vendure/commit/196fd7b)), closes [#4721](https://github.com/vendurehq/vendure/issues/4721)
* **core** Do not release inherited QueryRunner in TransactionWrapper (#4717) ([fc9a61d](https://github.com/vendurehq/vendure/commit/fc9a61d)), closes [#4717](https://github.com/vendurehq/vendure/issues/4717)
* **core** Load ProductVariant translations in OrderService.findOne (#4738) ([47fbe9d](https://github.com/vendurehq/vendure/commit/47fbe9d)), closes [#4738](https://github.com/vendurehq/vendure/issues/4738)
* **core** Prevent double-decoding of ID args in updatePromotion (#4740) ([96741bf](https://github.com/vendurehq/vendure/commit/96741bf)), closes [#4740](https://github.com/vendurehq/vendure/issues/4740)
* **core** Skip v3.6 asset translation migration on empty DB (#4733) ([5f83222](https://github.com/vendurehq/vendure/commit/5f83222)), closes [#4733](https://github.com/vendurehq/vendure/issues/4733)
* **core** Widen graphql version range to ^16.11.0 (#4716) ([0b8902e](https://github.com/vendurehq/vendure/commit/0b8902e)), closes [#4716](https://github.com/vendurehq/vendure/issues/4716)
* **create** Add vite as direct dev dependency in scaffolded projects (#4710) ([ad8292e](https://github.com/vendurehq/vendure/commit/ad8292e)), closes [#4710](https://github.com/vendurehq/vendure/issues/4710)
* **dashboard** Allow selecting nullable select items (#4801) ([fe183bd](https://github.com/vendurehq/vendure/commit/fe183bd)), closes [#4801](https://github.com/vendurehq/vendure/issues/4801)
* **dashboard** Apply addCustomFields to profile page route loader (#4734) ([1bf5442](https://github.com/vendurehq/vendure/commit/1bf5442)), closes [#4734](https://github.com/vendurehq/vendure/issues/4734)
* **dashboard** Apply column filters on list pages using OR filter operator (#4746) ([c2b48fc](https://github.com/vendurehq/vendure/commit/c2b48fc)), closes [#4746](https://github.com/vendurehq/vendure/issues/4746)
* **dashboard** Correctly initialize boolean configurable args (#4794) ([3398142](https://github.com/vendurehq/vendure/commit/3398142)), closes [#4794](https://github.com/vendurehq/vendure/issues/4794)
* **dashboard** Fix input in bulk facet value modal (#4750) ([0217494](https://github.com/vendurehq/vendure/commit/0217494)), closes [#4750](https://github.com/vendurehq/vendure/issues/4750)
* **dashboard** Fix relational custom field not saving on draft order (#4407) ([a58e11c](https://github.com/vendurehq/vendure/commit/a58e11c)), closes [#4407](https://github.com/vendurehq/vendure/issues/4407)
* **dashboard** Fix tiptap toolbar not reacting to state changes (#4705) ([e373b37](https://github.com/vendurehq/vendure/commit/e373b37)), closes [#4705](https://github.com/vendurehq/vendure/issues/4705)
* **dashboard** Forward onFocus and onKeyDown in AffixedInput (#4759) ([7b05f36](https://github.com/vendurehq/vendure/commit/7b05f36)), closes [#4759](https://github.com/vendurehq/vendure/issues/4759)
* **dashboard** Make AlertsProvider react to extensions registered after mount (#4747) ([c5f8f66](https://github.com/vendurehq/vendure/commit/c5f8f66)), closes [#4747](https://github.com/vendurehq/vendure/issues/4747)
* **dashboard** Multi-field administrator search and empty seller subtitle ([c0888dd](https://github.com/vendurehq/vendure/commit/c0888dd)), closes [#4778](https://github.com/vendurehq/vendure/issues/4778)
* **dashboard** Normalize .po glob patterns on Windows (#4751) ([db9f237](https://github.com/vendurehq/vendure/commit/db9f237)), closes [#4751](https://github.com/vendurehq/vendure/issues/4751)
* **dashboard** Preserve column visibility and fix Dialog title context (#4739) ([78acd02](https://github.com/vendurehq/vendure/commit/78acd02)), closes [#4739](https://github.com/vendurehq/vendure/issues/4739)
* **dashboard** Prevent struct custom field overflow (#4781) ([d232e25](https://github.com/vendurehq/vendure/commit/d232e25)), closes [#4781](https://github.com/vendurehq/vendure/issues/4781)
* **dashboard** Reduce layout shift and flicker from remote data (#4707) ([b25153e](https://github.com/vendurehq/vendure/commit/b25153e)), closes [#4707](https://github.com/vendurehq/vendure/issues/4707)
* **dashboard** Remove non permitted customfield from mutation before submit (#4431) ([5f31e0b](https://github.com/vendurehq/vendure/commit/5f31e0b)), closes [#4431](https://github.com/vendurehq/vendure/issues/4431)
* **dashboard** Resolve logout stuck in verifying state on failure (#4757) ([d5e4c30](https://github.com/vendurehq/vendure/commit/d5e4c30)), closes [#4757](https://github.com/vendurehq/vendure/issues/4757)
* **dashboard** Skip rate limit for static assets and add long-lived cache (#4709) ([563e6b3](https://github.com/vendurehq/vendure/commit/563e6b3)), closes [#4709](https://github.com/vendurehq/vendure/issues/4709)
* **dashboard** Stop logging "Uncompiled message detected" warnings (#4745) ([84d8663](https://github.com/vendurehq/vendure/commit/84d8663)), closes [#4745](https://github.com/vendurehq/vendure/issues/4745)
* **dashboard** Filter + master toggle on variant generation table (#4752) ([6087385](https://github.com/vendurehq/vendure/commit/6087385)), closes [#4752](https://github.com/vendurehq/vendure/issues/4752)

#### Perf

* **core** Fix findByCustomerId causing n+1 on productVariant relations (#4653) ([b4af4fc](https://github.com/vendurehq/vendure/commit/b4af4fc)), closes [#4653](https://github.com/vendurehq/vendure/issues/4653)
* **dashboard** Reduce heavy relation query (#4743) ([c66babf](https://github.com/vendurehq/vendure/commit/c66babf)), closes [#4743](https://github.com/vendurehq/vendure/issues/4743)

Note: This release reverts a change to the `graphql` dependency of all Vendure Core packages that was introduced in v3.6.3,
which caused compatibility issues in certain repos. If you had to work around this in the last version, you should be able
to remove the workaround now. See [#4716](https://github.com/vendurehq/vendure/issues/4716).

## <small>3.6.3 (2026-05-05)</small>


#### Fixes

* **admin-ui** Handle tokenMethod array form when generating ui-config (#4656) (#4663) ([a8ea074](https://github.com/vendurehq/vendure/commit/a8ea074)), closes [#4656](https://github.com/vendurehq/vendure/issues/4656) [#4663](https://github.com/vendurehq/vendure/issues/4663)
* **core** Avoid OOM in product-to-channel assign/remove via query relation strategy (#4669) ([801d9c0](https://github.com/vendurehq/vendure/commit/801d9c0)), closes [#4669](https://github.com/vendurehq/vendure/issues/4669)
* **core** Create job queues in onModuleInit instead of onApplicationBootstrap (#4680) ([bc72b22](https://github.com/vendurehq/vendure/commit/bc72b22)), closes [#4680](https://github.com/vendurehq/vendure/issues/4680)
* **core** Enforce usage limits for auto-applied promotions (#4405) ([3ec7ee3](https://github.com/vendurehq/vendure/commit/3ec7ee3)), closes [#4405](https://github.com/vendurehq/vendure/issues/4405)
* **core** Fix Asset update when custom field relations defined (#4696) ([db6d327](https://github.com/vendurehq/vendure/commit/db6d327)), closes [#4696](https://github.com/vendurehq/vendure/issues/4696)
* **core** Handle undefined relation in entity hydrator (#4672) ([20876e1](https://github.com/vendurehq/vendure/commit/20876e1)), closes [#4672](https://github.com/vendurehq/vendure/issues/4672)
* **core** Make state-machine transitions atomic on hook failure (#4689) ([0153518](https://github.com/vendurehq/vendure/commit/0153518)), closes [#4689](https://github.com/vendurehq/vendure/issues/4689)
* **core** Prevent coupon usage limit bypass via concurrent checkout race condition (#4660) ([b276364](https://github.com/vendurehq/vendure/commit/b276364)), closes [#4660](https://github.com/vendurehq/vendure/issues/4660)
* **core** Prevent duplicate execution of fast scheduled tasks (#4681) ([8f9a98e](https://github.com/vendurehq/vendure/commit/8f9a98e)), closes [#4681](https://github.com/vendurehq/vendure/issues/4681)
* **core** Resolve customer user via relation instead of email lookup (#4468) ([aeb692b](https://github.com/vendurehq/vendure/commit/aeb692b)), closes [#4468](https://github.com/vendurehq/vendure/issues/4468)
* **dashboard** Add dynamic y axis width to chart widget (#4516) ([8b4446b](https://github.com/vendurehq/vendure/commit/8b4446b)), closes [#4516](https://github.com/vendurehq/vendure/issues/4516)
* **dashboard** Add error messages to update draft order mutations (#4381) ([7eeacd7](https://github.com/vendurehq/vendure/commit/7eeacd7)), closes [#4381](https://github.com/vendurehq/vendure/issues/4381)
* **dashboard** Add missing include nested fragments in order modification preview (#4640) ([5047ef8](https://github.com/vendurehq/vendure/commit/5047ef8)), closes [#4640](https://github.com/vendurehq/vendure/issues/4640)
* **dashboard** Add missing Italian translations (#4645) ([8bd2a1f](https://github.com/vendurehq/vendure/commit/8bd2a1f)), closes [#4645](https://github.com/vendurehq/vendure/issues/4645)
* **dashboard** Check required permissions when rendering custom page (#4679) ([600c0df](https://github.com/vendurehq/vendure/commit/600c0df)), closes [#4679](https://github.com/vendurehq/vendure/issues/4679)
* **dashboard** correct mistranslated Swedish strings in sv.po (#4684) ([ebef82e](https://github.com/vendurehq/vendure/commit/ebef82e)), closes [#4684](https://github.com/vendurehq/vendure/issues/4684)
* **dashboard** Drop direct @base-ui/react imports (#4697) ([3f253d3](https://github.com/vendurehq/vendure/commit/3f253d3)), closes [#4697](https://github.com/vendurehq/vendure/issues/4697)
* **dashboard** Ensure fulfillment arg default value is a string (#4658) ([3ffaf88](https://github.com/vendurehq/vendure/commit/3ffaf88)), closes [#4658](https://github.com/vendurehq/vendure/issues/4658)
* **dashboard** Fall back to original block on denied replace extension (#4694) ([31bc0ff](https://github.com/vendurehq/vendure/commit/31bc0ff)), closes [#4694](https://github.com/vendurehq/vendure/issues/4694)
* **dashboard** Fix saving asset when custom fields are defined (#4695) ([a5576b2](https://github.com/vendurehq/vendure/commit/a5576b2)), closes [#4695](https://github.com/vendurehq/vendure/issues/4695)
* **dashboard** Handle empty customFields selection (#4652) ([c2574d1](https://github.com/vendurehq/vendure/commit/c2574d1)), closes [#4652](https://github.com/vendurehq/vendure/issues/4652)
* **dashboard** Implement `isFullWidth` metadata prop (#4638) ([7682dee](https://github.com/vendurehq/vendure/commit/7682dee)), closes [#4638](https://github.com/vendurehq/vendure/issues/4638)
* **dashboard** Inline route literal for tanstack router-generator (#4666) ([78c5d9c](https://github.com/vendurehq/vendure/commit/78c5d9c)), closes [#4666](https://github.com/vendurehq/vendure/issues/4666)
* **dashboard** Repair wrong-language msgstrs across hr/nb/tr/it/ja/ko/he/ro and harden i18n:apply (#4685) ([59612c1](https://github.com/vendurehq/vendure/commit/59612c1)), closes [#4685](https://github.com/vendurehq/vendure/issues/4685)
* **dashboard** Set default sort on promotions list (#4688) ([a07e967](https://github.com/vendurehq/vendure/commit/a07e967)), closes [#4688](https://github.com/vendurehq/vendure/issues/4688)
* **dashboard** Support action bar positioning relative to extensions (#4676) ([2672fe2](https://github.com/vendurehq/vendure/commit/2672fe2)), closes [#4676](https://github.com/vendurehq/vendure/issues/4676)
* **job-queue-plugin** Fix filtering in BullMQJobQueuePlugin (#4523) ([86d2a52](https://github.com/vendurehq/vendure/commit/86d2a52)), closes [#4523](https://github.com/vendurehq/vendure/issues/4523)

#### Features

* **dashboard** Add bulk cancel action and human-readable duration t… (#4361) ([a3f5a92](https://github.com/vendurehq/vendure/commit/a3f5a92)), closes [#4361](https://github.com/vendurehq/vendure/issues/4361)
* **dashboard** Add Romanian translations (#4598) ([88467a2](https://github.com/vendurehq/vendure/commit/88467a2)), closes [#4598](https://github.com/vendurehq/vendure/issues/4598)

## <small>3.6.2 (2026-04-13)</small>


#### Fixes

* **core** Fix SQL injection via languageCode query parameter (3ff0bc1)
* **core** Sanitize search term for Postgres tsquery syntax (32c947d)
* **core** Fix free shipping tax calculation (#4624) ([3e4fa43](https://github.com/vendurehq/vendure/commit/3e4fa43)), closes [#4624](https://github.com/vendurehq/vendure/issues/4624)

## <small>3.6.1 (2026-04-09)</small>


#### Features

* **dashboard** Add requiresPermissions support to dashboard widgets (#4627) ([d0c895f](https://github.com/vendurehq/vendure/commit/d0c895f)), closes [#4627](https://github.com/vendurehq/vendure/issues/4627)
* **dashboard** Allow creating single variant without option groups (#4616) ([98b4cf3](https://github.com/vendurehq/vendure/commit/98b4cf3)), closes [#4616](https://github.com/vendurehq/vendure/issues/4616)
* **dashboard** Support Zod v4 and re-export Zod from @vendure/dashboard (#4607) ([b3a6426](https://github.com/vendurehq/vendure/commit/b3a6426)), closes [#4607](https://github.com/vendurehq/vendure/issues/4607)

#### Fixes

* **cli** Resolve tsconfig by walking up from target directory (#4599) ([5817ea1](https://github.com/vendurehq/vendure/commit/5817ea1)), closes [#4599](https://github.com/vendurehq/vendure/issues/4599)
* **core** Assign Product entity to channel in assignProductsToChannel (#4618) ([830ec9c](https://github.com/vendurehq/vendure/commit/830ec9c)), closes [#4618](https://github.com/vendurehq/vendure/issues/4618)
* **core** Deduplicate channels in OrderSplitter when channelId matches default (#4631) (#4632) ([739f049](https://github.com/vendurehq/vendure/commit/739f049)), closes [#4631](https://github.com/vendurehq/vendure/issues/4631) [#4632](https://github.com/vendurehq/vendure/issues/4632)
* **dashboard** Fix hiding of toast notifications by dialogs (#4634) ([1f1070d](https://github.com/vendurehq/vendure/commit/1f1070d)), closes [#4634](https://github.com/vendurehq/vendure/issues/4634)
* **dashboard** Fix option group edit link on variant detail page (#4620) ([e63387a](https://github.com/vendurehq/vendure/commit/e63387a)), closes [#4620](https://github.com/vendurehq/vendure/issues/4620)
* **dashboard** Make address dialog scrollable with max h (#4622) ([4e50814](https://github.com/vendurehq/vendure/commit/4e50814)), closes [#4622](https://github.com/vendurehq/vendure/issues/4622)
* **dashboard** Match query key invalidation for channels (#4630) ([2fe3f4d](https://github.com/vendurehq/vendure/commit/2fe3f4d)), closes [#4630](https://github.com/vendurehq/vendure/issues/4630)
* **dashboard** Skip validation for unchecked variant rows (#4610) ([2896b4c](https://github.com/vendurehq/vendure/commit/2896b4c)), closes [#4610](https://github.com/vendurehq/vendure/issues/4610)

## 3.6.0 (2026-03-31)


#### Features

* **asset-server-plugin** Allow specifying encoding for AssetStorageStrategy (#3926) ([842a7df](https://github.com/vendurehq/vendure/commit/842a7df)), closes [#3926](https://github.com/vendurehq/vendure/issues/3926)
* **cli** Add codemod command for Radix to Base UI dashboard migration (#4536) ([bcf5711](https://github.com/vendurehq/vendure/commit/bcf5711)), closes [#4536](https://github.com/vendurehq/vendure/issues/4536)
* **core** Add anonymous telemetry collection module (#4192) ([4d092d1](https://github.com/vendurehq/vendure/commit/4d092d1)), closes [#4192](https://github.com/vendurehq/vendure/issues/4192)
* **core** Add collectionIds and collectionSlugs filters to default search plugin (#3945) ([82fcf0f](https://github.com/vendurehq/vendure/commit/82fcf0f)), closes [#3945](https://github.com/vendurehq/vendure/issues/3945)
* **core** Add configurable OrderTaxCalculationStrategy (#4376) ([6d53fa9](https://github.com/vendurehq/vendure/commit/6d53fa9)), closes [#4376](https://github.com/vendurehq/vendure/issues/4376)
* **core** Add EntityAccessControlStrategy for row-level access control (#4451) ([96e40cc](https://github.com/vendurehq/vendure/commit/96e40cc)), closes [#4451](https://github.com/vendurehq/vendure/issues/4451)
* **core** Add migrateAssetTranslationData() helper for v3.6 upgrade (#4584) ([99d237b](https://github.com/vendurehq/vendure/commit/99d237b)), closes [#4584](https://github.com/vendurehq/vendure/issues/4584)
* **core** Add Shop API mutation to set order currency code (#4466) ([7f246a6](https://github.com/vendurehq/vendure/commit/7f246a6)), closes [#4466](https://github.com/vendurehq/vendure/issues/4466)
* **core** Allow async `OrderMergeStrategy` (#4436) ([cc58504](https://github.com/vendurehq/vendure/commit/cc58504)), closes [#4436](https://github.com/vendurehq/vendure/issues/4436)
* **core** API Key support (#3815) ([c4e0d99](https://github.com/vendurehq/vendure/commit/c4e0d99)), closes [#3815](https://github.com/vendurehq/vendure/issues/3815)
* **core** Expand telemetry with strategy, integration and feature adoption data (#4554) ([52f8f45](https://github.com/vendurehq/vendure/commit/52f8f45)), closes [#4554](https://github.com/vendurehq/vendure/issues/4554)
* **core** Introduce BootstrappedEvent to signal server readiness (#4498) ([d3459c0](https://github.com/vendurehq/vendure/commit/d3459c0)), closes [#4498](https://github.com/vendurehq/vendure/issues/4498)
* **core** Make ProductOptionGroup & ProductOption shared and channel-aware (#4469) ([d0384f3](https://github.com/vendurehq/vendure/commit/d0384f3)), closes [#4469](https://github.com/vendurehq/vendure/issues/4469)
* **core** New `onBeforeAppListen` to operate on Nest app before listen (#4383) ([2b5a887](https://github.com/vendurehq/vendure/commit/2b5a887)), closes [#4383](https://github.com/vendurehq/vendure/issues/4383)
* **core** Support shared product option groups in CSV import (#4503) ([0808146](https://github.com/vendurehq/vendure/commit/0808146)), closes [#4503](https://github.com/vendurehq/vendure/issues/4503)
* **dashboard** Add API keys management UI (#4583) ([29ad666](https://github.com/vendurehq/vendure/commit/29ad666)), closes [#4583](https://github.com/vendurehq/vendure/issues/4583)
* **dashboard** Add Option Groups management page (#4483) ([80ef477](https://github.com/vendurehq/vendure/commit/80ef477)), closes [#4483](https://github.com/vendurehq/vendure/issues/4483)
* **dashboard** Add Settings Store management page (#4473) ([61f790d](https://github.com/vendurehq/vendure/commit/61f790d)), closes [#4473](https://github.com/vendurehq/vendure/issues/4473)
* **dashboard** Add toolbarItems extension point to app shell header (#4496) ([6fe1a67](https://github.com/vendurehq/vendure/commit/6fe1a67)), closes [#4496](https://github.com/vendurehq/vendure/issues/4496)
* **dashboard** Allow component-based alert actions for hook access (#4526) ([7702114](https://github.com/vendurehq/vendure/commit/7702114)), closes [#4526](https://github.com/vendurehq/vendure/issues/4526)
* **dashboard** Improved extensibility of ActionBar (#4049) ([f6184b6](https://github.com/vendurehq/vendure/commit/f6184b6)), closes [#4049](https://github.com/vendurehq/vendure/issues/4049)
* **dashboard** Support function form for navSections (#4491) ([5e1cad3](https://github.com/vendurehq/vendure/commit/5e1cad3)), closes [#4491](https://github.com/vendurehq/vendure/issues/4491)
* **dashboard** Translation fallback placeholders for translatable fields (#4549) ([411b21e](https://github.com/vendurehq/vendure/commit/411b21e)), closes [#4549](https://github.com/vendurehq/vendure/issues/4549)
* **dashboard** Upgrade Vite from v6 to v7 (#4514) ([47dc168](https://github.com/vendurehq/vendure/commit/47dc168)), closes [#4514](https://github.com/vendurehq/vendure/issues/4514)
* **email-plugin** Add support for asynchronous email generators (#3976) ([3ae219b](https://github.com/vendurehq/vendure/commit/3ae219b)), closes [#3976](https://github.com/vendurehq/vendure/issues/3976)

#### Fixes

* **core** Allow admin re-creation after soft-delete (#4543) ([f4029ef](https://github.com/vendurehq/vendure/commit/f4029ef)), closes [#4543](https://github.com/vendurehq/vendure/issues/4543)
* **core** Migrate entity-event e2e test to typed document pattern ([6f51232](https://github.com/vendurehq/vendure/commit/6f51232))
* **core** Server-side translation field-level fallback for empty values (#4551) ([d94ac75](https://github.com/vendurehq/vendure/commit/d94ac75)), closes [#4551](https://github.com/vendurehq/vendure/issues/4551)
* **dashboard** Add shared-types and shared-utils to Vite optimizeDeps (#4520) ([1614ee3](https://github.com/vendurehq/vendure/commit/1614ee3)), closes [#4520](https://github.com/vendurehq/vendure/issues/4520)
* **dashboard** Align styling with design system tokens (#4575) ([9e81c36](https://github.com/vendurehq/vendure/commit/9e81c36)), closes [#4575](https://github.com/vendurehq/vendure/issues/4575)
* **dashboard** Display custom fields on product variant prices (#4180) ([d34804c](https://github.com/vendurehq/vendure/commit/d34804c)), closes [#4180](https://github.com/vendurehq/vendure/issues/4180)
* **dashboard** Fix ambiguous export of ActionBarItem ([7106e3a](https://github.com/vendurehq/vendure/commit/7106e3a))
* **dashboard** Fix collection expand e2e test for minor branch ([0eba4fc](https://github.com/vendurehq/vendure/commit/0eba4fc))
* **dashboard** Fix component styling regressions from Base UI migration (#4552) ([ad4305c](https://github.com/vendurehq/vendure/commit/ad4305c)), closes [#4552](https://github.com/vendurehq/vendure/issues/4552)
* **dashboard** Fix merge issues ([6dec164](https://github.com/vendurehq/vendure/commit/6dec164))
* **dashboard** Follow transitive dependencies in plugin discovery (#4545) ([79b5454](https://github.com/vendurehq/vendure/commit/79b5454)), closes [#4545](https://github.com/vendurehq/vendure/issues/4545)
* **dashboard** Hide dev mode ring offset when not hovered (#4558) ([ea34144](https://github.com/vendurehq/vendure/commit/ea34144)), closes [#4558](https://github.com/vendurehq/vendure/issues/4558)
* **dashboard** Use aria-label for collection expand button in e2e tests ([1af90cd](https://github.com/vendurehq/vendure/commit/1af90cd))
* **job-queue-plugin** Update ioredis to 5.9.3 to match bullmq dependency ([239196c](https://github.com/vendurehq/vendure/commit/239196c))

## <small>3.5.6 (2026-03-30)</small>


#### Fixes

* **core** Make OrderService.mergeOrders atomic and concurrency-safe (#4488) ([c3bc80f](https://github.com/vendurehq/vendure/commit/c3bc80f)), closes [#4488](https://github.com/vendurehq/vendure/issues/4488)
* **core** Remove stale shipping lines when shipping method no longer exists (#4487) ([3be14c8](https://github.com/vendurehq/vendure/commit/3be14c8)), closes [#4487](https://github.com/vendurehq/vendure/issues/4487)
* **core** Use schema-qualified table paths in EXISTS subqueries (#4501) ([7781742](https://github.com/vendurehq/vendure/commit/7781742)), closes [#4501](https://github.com/vendurehq/vendure/issues/4501)
* **core** Widen TranslationInput languageCode to accept string literal unions (#4534) ([cd50fba](https://github.com/vendurehq/vendure/commit/cd50fba)), closes [#4534](https://github.com/vendurehq/vendure/issues/4534)
* **dashboard**  MoneyInput component to handle focus state and onChange (#4586) ([e07a1a6](https://github.com/vendurehq/vendure/commit/e07a1a6)), closes [#4586](https://github.com/vendurehq/vendure/issues/4586)
* **dashboard** Add missing i18n translations and CI sync check (#4578) ([9b310fd](https://github.com/vendurehq/vendure/commit/9b310fd)), closes [#4578](https://github.com/vendurehq/vendure/issues/4578)
* **dashboard** Add nested address custom field in customer detail (#4546) ([cfcab42](https://github.com/vendurehq/vendure/commit/cfcab42)), closes [#4546](https://github.com/vendurehq/vendure/issues/4546)
* **dashboard** Channel cache invalidation after update (#4461) ([be8b7b0](https://github.com/vendurehq/vendure/commit/be8b7b0)), closes [#4461](https://github.com/vendurehq/vendure/issues/4461)
* **dashboard** Detect plugins compiled with tslib importHelpers (#4518) ([4b49c30](https://github.com/vendurehq/vendure/commit/4b49c30)), closes [#4518](https://github.com/vendurehq/vendure/issues/4518)
* **dashboard** Display product options on variant detail page (#4187) ([6c556de](https://github.com/vendurehq/vendure/commit/6c556de)), closes [#4187](https://github.com/vendurehq/vendure/issues/4187)
* **dashboard** Display variant creation errors and list query errors (#4460) ([0dc2bfe](https://github.com/vendurehq/vendure/commit/0dc2bfe)), closes [#4460](https://github.com/vendurehq/vendure/issues/4460)
* **dashboard** Fix payment and fulfillment state icons in non-English locales (#4454) ([8b0d6b1](https://github.com/vendurehq/vendure/commit/8b0d6b1)), closes [#4454](https://github.com/vendurehq/vendure/issues/4454) [#4454](https://github.com/vendurehq/vendure/issues/4454)
* **dashboard** Fix validation & UX issues in product variant option groups (#4458) ([a635eb2](https://github.com/vendurehq/vendure/commit/a635eb2)), closes [#4458](https://github.com/vendurehq/vendure/issues/4458)
* **dashboard** Forward all ControllerProps in FormFieldWrapper (#4513) ([abb7ba5](https://github.com/vendurehq/vendure/commit/abb7ba5)), closes [#4513](https://github.com/vendurehq/vendure/issues/4513)
* **dashboard** Pass correct currency prop to Money component in order table (#4541) ([a8227cf](https://github.com/vendurehq/vendure/commit/a8227cf)), closes [#4541](https://github.com/vendurehq/vendure/issues/4541)
* **dashboard** Persist collection tree expanded state in URL search params (#4509) ([8f133ca](https://github.com/vendurehq/vendure/commit/8f133ca)), closes [#4509](https://github.com/vendurehq/vendure/issues/4509)
* **dashboard** Replace ts.createProgram with per-file transpilation to prevent OOM (#4561) ([c06959e](https://github.com/vendurehq/vendure/commit/c06959e)), closes [#4561](https://github.com/vendurehq/vendure/issues/4561)
* **dashboard** Set channel token before query invalidation (#4472) ([57b1b35](https://github.com/vendurehq/vendure/commit/57b1b35)), closes [#4472](https://github.com/vendurehq/vendure/issues/4472)
* **dashboard** Show hover card for collapsed sidebar nav sections (#4440) ([281190f](https://github.com/vendurehq/vendure/commit/281190f)), closes [#4440](https://github.com/vendurehq/vendure/issues/4440)
* **dashboard** Treat args with defaultValue as valid in ConfigurableOperationInput (#4462) ([1f92dd2](https://github.com/vendurehq/vendure/commit/1f92dd2)), closes [#4462](https://github.com/vendurehq/vendure/issues/4462)
* **dashboard** Update breadcrumb reactively after entity mutation (#4512) ([86a9799](https://github.com/vendurehq/vendure/commit/86a9799)), closes [#4512](https://github.com/vendurehq/vendure/issues/4512)
* **dashboard** Use null instead of undefined when clearing relation custom fields (#4495) ([d6e148c](https://github.com/vendurehq/vendure/commit/d6e148c)), closes [#4495](https://github.com/vendurehq/vendure/issues/4495)
* **dashboard** Use tsconfig baseUrl as source root for monorepo pathAdapters (#4570) ([0f758a3](https://github.com/vendurehq/vendure/commit/0f758a3)), closes [#4570](https://github.com/vendurehq/vendure/issues/4570)
* **dashboard** Wrap faceted filters to prevent horizontal overflow (#4467) ([ff485a6](https://github.com/vendurehq/vendure/commit/ff485a6)), closes [#4467](https://github.com/vendurehq/vendure/issues/4467)

#### Features

* **core** Add `dashboard` option to hide custom fields from Dashboard UI (#4544) ([8ee63e6](https://github.com/vendurehq/vendure/commit/8ee63e6)), closes [#4544](https://github.com/vendurehq/vendure/issues/4544)
* **dashboard** Add Hungarian translations (#4423) ([57530f8](https://github.com/vendurehq/vendure/commit/57530f8)), closes [#4423](https://github.com/vendurehq/vendure/issues/4423)

## <small>3.5.5 (2026-02-27)</small>


#### Fixes

* **cli** Fix crash when cancelling follow-up feature selection during plugin creation (#4371) ([12d1ef8](https://github.com/vendurehq/vendure/commit/12d1ef8)), closes [#4371](https://github.com/vendurehq/vendure/issues/4371)
* **core** Handle empty sortedAssets in updateEntityAssets (#4397) ([6c81359](https://github.com/vendurehq/vendure/commit/6c81359)), closes [#4397](https://github.com/vendurehq/vendure/issues/4397)
* **core** Include channelId in productInStock cache key (#4214) ([b3d1903](https://github.com/vendurehq/vendure/commit/b3d1903)), closes [#4214](https://github.com/vendurehq/vendure/issues/4214)
* **core** Persist customFields in updateGlobalSettings mutation (#4343) ([1633446](https://github.com/vendurehq/vendure/commit/1633446)), closes [#4343](https://github.com/vendurehq/vendure/issues/4343)
* **core** Use channel language fallbacks in FacetService and FacetValueService (#4434) ([ee20cf7](https://github.com/vendurehq/vendure/commit/ee20cf7)), closes [#4434](https://github.com/vendurehq/vendure/issues/4434)
* **create** Use promise-based mysql2 API for database check (#4418) ([bb79a09](https://github.com/vendurehq/vendure/commit/bb79a09)), closes [#4418](https://github.com/vendurehq/vendure/issues/4418)
* **dashboard** Add "Now" button to date time picker ([92d9e40](https://github.com/vendurehq/vendure/commit/92d9e40)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Add custom fields of fulfillment in dashboard (#4386) ([d8ea154](https://github.com/vendurehq/vendure/commit/d8ea154)), closes [#4386](https://github.com/vendurehq/vendure/issues/4386)
* **dashboard** Add missing dashboard dependency (#4384) ([0ebf1ca](https://github.com/vendurehq/vendure/commit/0ebf1ca)), closes [#4384](https://github.com/vendurehq/vendure/issues/4384)
* **dashboard** Add recalculate shipping checkbox to order modification ([de0d2a8](https://github.com/vendurehq/vendure/commit/de0d2a8)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Add scroll to configurable operation dropdown (#4435) ([18471df](https://github.com/vendurehq/vendure/commit/18471df)), closes [#4435](https://github.com/vendurehq/vendure/issues/4435)
* **dashboard** Default order list sort to updatedAt instead of orderPlacedAt ([8984612](https://github.com/vendurehq/vendure/commit/8984612)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Default product list sort to newest first ([3e1836a](https://github.com/vendurehq/vendure/commit/3e1836a)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Display custom order history entry types ([3baa5cc](https://github.com/vendurehq/vendure/commit/3baa5cc)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Fix column settings dropdown clipping and Reset button overlap ([01197a1](https://github.com/vendurehq/vendure/commit/01197a1)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Fix metrics tooltip text unreadable in dark mode ([63e7dd3](https://github.com/vendurehq/vendure/commit/63e7dd3)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Fix order line discounts showing `[object Object]` (#4378) ([89973ab](https://github.com/vendurehq/vendure/commit/89973ab)), closes [#4378](https://github.com/vendurehq/vendure/issues/4378)
* **dashboard** Keep address visible when editing during order modification (#4413) ([7207123](https://github.com/vendurehq/vendure/commit/7207123)), closes [#4413](https://github.com/vendurehq/vendure/issues/4413)
* **dashboard** Only show "Show all" button when 2+ items are hidden ([9c37579](https://github.com/vendurehq/vendure/commit/9c37579)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Propagate disabled state via React props for all form inputs (#4425) ([dcd8c81](https://github.com/vendurehq/vendure/commit/dcd8c81)), closes [#4425](https://github.com/vendurehq/vendure/issues/4425)
* **dashboard** Refresh language selector after saving language (#4417) ([738473d](https://github.com/vendurehq/vendure/commit/738473d)), closes [#4417](https://github.com/vendurehq/vendure/issues/4417)
* **dashboard** Return null for nullable non-string field defaults (#4339) ([80cdd07](https://github.com/vendurehq/vendure/commit/80cdd07)), closes [#4339](https://github.com/vendurehq/vendure/issues/4339)
* **dashboard** Show badge instead of dropdown for single option groups ([36416a6](https://github.com/vendurehq/vendure/commit/36416a6)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)
* **dashboard** Show custom fields edit button on OrderLine in modify order page (#4432) ([e7725c4](https://github.com/vendurehq/vendure/commit/e7725c4)), closes [#4432](https://github.com/vendurehq/vendure/issues/4432)
* **dashboard** Wrap custom field tabs when they overflow container ([eede10d](https://github.com/vendurehq/vendure/commit/eede10d)), closes [#4393](https://github.com/vendurehq/vendure/issues/4393)

#### Features

* **dashboard** Add facet value filter to product & variant lists (#4415) ([d36e99c](https://github.com/vendurehq/vendure/commit/d36e99c)), closes [#4415](https://github.com/vendurehq/vendure/issues/4415)

## <small>3.5.4 (2026-02-17)</small>


#### Fixes

* **core** Emit post-update entity in VendureEntityEvent for updated events (#4352) ([7b6c421](https://github.com/vendurehq/vendure/commit/7b6c421)), closes [#4352](https://github.com/vendurehq/vendure/issues/4352)
* **core** Fix coupon code removal not clearing adjustments ([bf397cc](https://github.com/vendurehq/vendure/commit/bf397cc)), closes [#4016](https://github.com/vendurehq/vendure/issues/4016)
* **core** Run promotion side effects before OrderLine save (#4350) ([bb5fa6c](https://github.com/vendurehq/vendure/commit/bb5fa6c)), closes [#4350](https://github.com/vendurehq/vendure/issues/4350)
* **core** Use channel-aware cache keys for active tax zone (#4329) ([eb13562](https://github.com/vendurehq/vendure/commit/eb13562)), closes [#4329](https://github.com/vendurehq/vendure/issues/4329)
* **create** Add ts-node to scaffolded project devDependencies (#4212) ([4febc48](https://github.com/vendurehq/vendure/commit/4febc48)), closes [#4212](https://github.com/vendurehq/vendure/issues/4212)
* **create** Fix welcome message on create (#4363) ([ab61ee7](https://github.com/vendurehq/vendure/commit/ab61ee7)), closes [#4363](https://github.com/vendurehq/vendure/issues/4363)
* **create** Use explicit localhost API host in vite config template (#4349) ([6476fb9](https://github.com/vendurehq/vendure/commit/6476fb9)), closes [#4349](https://github.com/vendurehq/vendure/issues/4349)
* **dashboard** Add missing translations and CI check script (#4207) ([0727ef4](https://github.com/vendurehq/vendure/commit/0727ef4)), closes [#4207](https://github.com/vendurehq/vendure/issues/4207)
* **dashboard** Fix list relation custom fields not saving correctly (#4206) ([b28e64e](https://github.com/vendurehq/vendure/commit/b28e64e)), closes [#4206](https://github.com/vendurehq/vendure/issues/4206)
* **dashboard** Pass native arrays from FacetValueInput onChange ([510ecc2](https://github.com/vendurehq/vendure/commit/510ecc2)), closes [#4146](https://github.com/vendurehq/vendure/issues/4146)
* **dashboard** Refresh order entity and history after all mutations (#4338) ([e91671e](https://github.com/vendurehq/vendure/commit/e91671e)), closes [#4338](https://github.com/vendurehq/vendure/issues/4338)
* **dashboard** Resolve ESM path aliases relative to source file location (#4323) ([cc520c9](https://github.com/vendurehq/vendure/commit/cc520c9)), closes [#4323](https://github.com/vendurehq/vendure/issues/4323)
* **dashboard** Validate required args in ConfigurableOperationInput (#4202) ([d1372e5](https://github.com/vendurehq/vendure/commit/d1372e5)), closes [#4202](https://github.com/vendurehq/vendure/issues/4202)
* **graphiql-plugin** Make embedded mode background transparent (#4205) ([3bb3608](https://github.com/vendurehq/vendure/commit/3bb3608)), closes [#4205](https://github.com/vendurehq/vendure/issues/4205)

#### Features

* **core** Export FSM utility functions from public API ([895644b](https://github.com/vendurehq/vendure/commit/895644b))

## <small>3.5.3 (2026-01-30)</small>

#### Security

* **core** Prevent account enumeration via timing attack in NativeAuthenticationStrategy ([7f0c555](https://github.com/vendurehq/vendure/commit/7f0c5556ecddb44a5d5208677a45fdd5923b0cc9)) [CVE-2026-25050] ([security advisory](https://github.com/vendurehq/vendure/security/advisories/GHSA-6f65-4fv2-wwch)). Responsibly disclosed by [Christbowel](https://github.com/Christbowel).

#### Fixes

* **admin-ui** Fix admin-ui publish dir in npm publish workflow (#4131) ([78a606b](https://github.com/vendurehq/vendure/commit/78a606b)), closes [#4131](https://github.com/vendurehq/vendure/issues/4131)
* **core** Correctly publish ChangeChannelEvent with new channel IDs. (#4176) ([4f31ba3](https://github.com/vendurehq/vendure/commit/4f31ba3)), closes [#4176](https://github.com/vendurehq/vendure/issues/4176)
* **core** Exclude seller orders when counting promotion usage (#4070) ([fe72cdb](https://github.com/vendurehq/vendure/commit/fe72cdb)), closes [#4070](https://github.com/vendurehq/vendure/issues/4070)
* **core** Fix SubscribableJob.updates() completing after single emission (#4120) ([45c2e66](https://github.com/vendurehq/vendure/commit/45c2e66)), closes [#4120](https://github.com/vendurehq/vendure/issues/4120)
* **core** Persist custom fields when creating new ProductVariantPrice (#4184) ([6f63965](https://github.com/vendurehq/vendure/commit/6f63965)), closes [#4184](https://github.com/vendurehq/vendure/issues/4184)
* **core** Use previously unused relations filter in findByCustomerId (#4118) ([8859797](https://github.com/vendurehq/vendure/commit/8859797)), closes [#4118](https://github.com/vendurehq/vendure/issues/4118)
* **create** add useDefineForClassFields to fix ES2022 (#4116) ([fe25af0](https://github.com/vendurehq/vendure/commit/fe25af0)), closes [#4116](https://github.com/vendurehq/vendure/issues/4116)
* **create** Set api url to `auto` for newly created projects (#4102) ([82c165c](https://github.com/vendurehq/vendure/commit/82c165c)), closes [#4102](https://github.com/vendurehq/vendure/issues/4102)
* **dashboard** Boolean fields in DetailPage now show correct value (#4186) ([58a7e4d](https://github.com/vendurehq/vendure/commit/58a7e4d)), closes [#4186](https://github.com/vendurehq/vendure/issues/4186)
* **dashboard** Bump @tanstack/react-router to fix ID param error (#4153) ([dac5315](https://github.com/vendurehq/vendure/commit/dac5315)), closes [#4153](https://github.com/vendurehq/vendure/issues/4153)
* **dashboard** Channel switcher not scrollable if list exceeds screen height (#4075) ([9c1081a](https://github.com/vendurehq/vendure/commit/9c1081a)), closes [#4075](https://github.com/vendurehq/vendure/issues/4075)
* **dashboard** Clarify draft order completion UX (#4163) ([e72f822](https://github.com/vendurehq/vendure/commit/e72f822)), closes [#4163](https://github.com/vendurehq/vendure/issues/4163)
* **dashboard** Collection contents not showing after saving filters (#4128) ([8593513](https://github.com/vendurehq/vendure/commit/8593513)), closes [#4128](https://github.com/vendurehq/vendure/issues/4128)
* **dashboard** Dashboard plugin detection with pnpm (#4126) ([896dc62](https://github.com/vendurehq/vendure/commit/896dc62)), closes [#4126](https://github.com/vendurehq/vendure/issues/4126)
* **dashboard** Display custom fields on product variant prices (#4180) ([11192d3](https://github.com/vendurehq/vendure/commit/11192d3)), closes [#4180](https://github.com/vendurehq/vendure/issues/4180)
* **dashboard** Fallback to default input when custom form component not found (#4168) ([5ab2a5d](https://github.com/vendurehq/vendure/commit/5ab2a5d)), closes [#4168](https://github.com/vendurehq/vendure/issues/4168)
* **dashboard** Fix compilation issues caused by SWC version issues (#4105) ([8f5496a](https://github.com/vendurehq/vendure/commit/8f5496a)), closes [#4105](https://github.com/vendurehq/vendure/issues/4105)
* **dashboard** Fix displaying HistoryEntry for CustomerEmailUpdateComponent (#4167) ([bab3b5e](https://github.com/vendurehq/vendure/commit/bab3b5e)), closes [#4167](https://github.com/vendurehq/vendure/issues/4167)
* **dashboard** Fix entity creation when using a non default language (#4157) ([5439d17](https://github.com/vendurehq/vendure/commit/5439d17)), closes [#4157](https://github.com/vendurehq/vendure/issues/4157)
* **dashboard** Fix gross price display under price includes tax (#4138) ([37c2ff8](https://github.com/vendurehq/vendure/commit/37c2ff8)), closes [#4138](https://github.com/vendurehq/vendure/issues/4138)
* **dashboard** Fix incorrect currency being displayed in latest orders widget (#4090) ([f3a47ef](https://github.com/vendurehq/vendure/commit/f3a47ef)), closes [#4090](https://github.com/vendurehq/vendure/issues/4090)
* **dashboard** Fix struct custom fields not rendering options or custom components (#4115) ([27ba769](https://github.com/vendurehq/vendure/commit/27ba769)), closes [#4115](https://github.com/vendurehq/vendure/issues/4115)
* **dashboard** Fix usePaginatedList context duplication in extensions (#4164) ([f07fee7](https://github.com/vendurehq/vendure/commit/f07fee7)), closes [#4164](https://github.com/vendurehq/vendure/issues/4164)
* **dashboard** Hide "Add channel" button for users without CreateChannel permission (#4097) ([84d7733](https://github.com/vendurehq/vendure/commit/84d7733)), closes [#4097](https://github.com/vendurehq/vendure/issues/4097)
* **dashboard** Hide bulk action bar when no selected items are visible (#4151) ([d1a514b](https://github.com/vendurehq/vendure/commit/d1a514b)), closes [#4151](https://github.com/vendurehq/vendure/issues/4151)
* **dashboard** Persist localeString/localeText custom fields on translatable entities (#4185) ([b75aa3b](https://github.com/vendurehq/vendure/commit/b75aa3b)), closes [#4185](https://github.com/vendurehq/vendure/issues/4185)
* **dashboard** Preserve string arg values without JSON parsing in form inputs (#4156) ([550242f](https://github.com/vendurehq/vendure/commit/550242f)), closes [#4156](https://github.com/vendurehq/vendure/issues/4156)
* **dashboard** Prevent NaN or empty values in Latest Orders table (#4092) ([e1d277e](https://github.com/vendurehq/vendure/commit/e1d277e)), closes [#4092](https://github.com/vendurehq/vendure/issues/4092)
* **dashboard** Re-sync channel token when activeChannelId persists but token is cleared (#4094) ([2f3ff85](https://github.com/vendurehq/vendure/commit/2f3ff85)), closes [#4094](https://github.com/vendurehq/vendure/issues/4094) [#4095](https://github.com/vendurehq/vendure/issues/4095)
* **dashboard** Register text-form-input component (#4149) ([89550d3](https://github.com/vendurehq/vendure/commit/89550d3)), closes [#4149](https://github.com/vendurehq/vendure/issues/4149)
* **dashboard** Resolve tsconfig path aliases in ESM mode (#4134) ([a99500d](https://github.com/vendurehq/vendure/commit/a99500d)), closes [#4134](https://github.com/vendurehq/vendure/issues/4134)
* **dashboard** Show all items in the order details page (#4160) ([8cb0520](https://github.com/vendurehq/vendure/commit/8cb0520)), closes [#4160](https://github.com/vendurehq/vendure/issues/4160)
* **dashboard** Support Bun package manager in plugin discovery (#4183) ([0934924](https://github.com/vendurehq/vendure/commit/0934924)), closes [#4183](https://github.com/vendurehq/vendure/issues/4183)
* **dashboard** Transform Lingui macros in third-party npm packages (#4182) ([c940778](https://github.com/vendurehq/vendure/commit/c940778)), closes [#4182](https://github.com/vendurehq/vendure/issues/4182)
* **payments-plugin** Mollie - allow overriding `immediateCapture` from the plugin level (#4142) ([dfda66d](https://github.com/vendurehq/vendure/commit/dfda66d)), closes [#4142](https://github.com/vendurehq/vendure/issues/4142)

#### Features

* **core** Expand userHasPermissions docstring; Add new userHasAllPermissions method  (#4107) ([f2d0359](https://github.com/vendurehq/vendure/commit/f2d0359)), closes [#4107](https://github.com/vendurehq/vendure/issues/4107)
* **dashboard** Add disabled option to exclude columns in ListPage (#4170) ([3ad9b55](https://github.com/vendurehq/vendure/commit/3ad9b55)), closes [#4170](https://github.com/vendurehq/vendure/issues/4170)
* **dashboard** Add pagination for sub-collections in collection list (#4154) ([2c837e0](https://github.com/vendurehq/vendure/commit/2c837e0)), closes [#4154](https://github.com/vendurehq/vendure/issues/4154)
* **dashboard** Add refund order dialog (#4130) ([65afa02](https://github.com/vendurehq/vendure/commit/65afa02)), closes [#4130](https://github.com/vendurehq/vendure/issues/4130)
* **dashboard** Customer list also filters on phoneNumber (#4100) ([6e49ea6](https://github.com/vendurehq/vendure/commit/6e49ea6)), closes [#4100](https://github.com/vendurehq/vendure/issues/4100)
* **dashboard** Display authentication methods on profile page (#4179) ([09c52f4](https://github.com/vendurehq/vendure/commit/09c52f4)), closes [#4179](https://github.com/vendurehq/vendure/issues/4179)
* **dashboard** Provide entity object to draft-order-detail Page component (#4073) ([bad41da](https://github.com/vendurehq/vendure/commit/bad41da)), closes [#4073](https://github.com/vendurehq/vendure/issues/4073)
* **dashboard** Use dynamic schema-driven languages and currencies (#4111) ([888e946](https://github.com/vendurehq/vendure/commit/888e946)), closes [#4111](https://github.com/vendurehq/vendure/issues/4111)

#### Perf

* **core** Implement productVariantCount in collections query (#4132) ([44bad11](https://github.com/vendurehq/vendure/commit/44bad11)), closes [#4132](https://github.com/vendurehq/vendure/issues/4132)

## <small>3.5.2 (2025-12-19)</small>


#### Fixes

* **admin-ui** Ensure outOfStockThreshold works when global setting is toggled ([b8d5492](https://github.com/vendure-ecommerce/vendure/commit/b8d5492))
* **core** Correct behaviour of complex list filtering (#4068) ([68cde97](https://github.com/vendure-ecommerce/vendure/commit/68cde97)), closes [#4068](https://github.com/vendure-ecommerce/vendure/issues/4068)
* **core** Fix scheduled task concurrent execution on Postgres (#4069) ([a80d24b](https://github.com/vendure-ecommerce/vendure/commit/a80d24b)), closes [#4069](https://github.com/vendure-ecommerce/vendure/issues/4069)
* **core** Update validation for session when using relationLoadStrategy query (#3691) ([a70ea6b](https://github.com/vendure-ecommerce/vendure/commit/a70ea6b)), closes [#3691](https://github.com/vendure-ecommerce/vendure/issues/3691)
* **create** Handle port conflicts between server & storefront ([e4c2d5a](https://github.com/vendure-ecommerce/vendure/commit/e4c2d5a))
* **create** Use actual server port for vite config ([60b9144](https://github.com/vendure-ecommerce/vendure/commit/60b9144))
* **dashboard** Avoid 429 errors in dev mode ([6d52887](https://github.com/vendure-ecommerce/vendure/commit/6d52887))
* **dashboard** Decimal values in tax rate input (#4052) ([01a17cc](https://github.com/vendure-ecommerce/vendure/commit/01a17cc)), closes [#4052](https://github.com/vendure-ecommerce/vendure/issues/4052)
* **dashboard** Display shipping method in order summary (#4054) ([e7e8ff8](https://github.com/vendure-ecommerce/vendure/commit/e7e8ff8)), closes [#4054](https://github.com/vendure-ecommerce/vendure/issues/4054)
* **dashboard** Fix custom icons in data table faceted filters (#3998) ([70492e4](https://github.com/vendure-ecommerce/vendure/commit/70492e4)), closes [#3998](https://github.com/vendure-ecommerce/vendure/issues/3998)
* **dashboard** Fix error due to ProductVariantPrice custom fields ([29e6484](https://github.com/vendure-ecommerce/vendure/commit/29e6484))
* **dashboard** Fix facet values sheet in facet list (#4064) ([883a09e](https://github.com/vendure-ecommerce/vendure/commit/883a09e)), closes [#4064](https://github.com/vendure-ecommerce/vendure/issues/4064)
* **dashboard** Fix for custom nav section placement (#3995) ([372fbf3](https://github.com/vendure-ecommerce/vendure/commit/372fbf3)), closes [#3995](https://github.com/vendure-ecommerce/vendure/issues/3995)
* **dashboard** Fix port:auto for api requests (#3980) ([14f42c0](https://github.com/vendure-ecommerce/vendure/commit/14f42c0)), closes [#3980](https://github.com/vendure-ecommerce/vendure/issues/3980)
* **dashboard** Fix products breadcrumb from variant detail ([d874f86](https://github.com/vendure-ecommerce/vendure/commit/d874f86)), closes [#4019](https://github.com/vendure-ecommerce/vendure/issues/4019)
* **dashboard** Fix tsc error ([2c26ad7](https://github.com/vendure-ecommerce/vendure/commit/2c26ad7))
* **dashboard** Further fix to rate limiting in dev mode ([a335a60](https://github.com/vendure-ecommerce/vendure/commit/a335a60))
* **dashboard** Improve RTL layout and Arabic translation in dashboard (#4008) ([ae003b9](https://github.com/vendure-ecommerce/vendure/commit/ae003b9)), closes [#4008](https://github.com/vendure-ecommerce/vendure/issues/4008)
* **dashboard** keep job queue dropdown open during auto refresh (#4059) ([6eb2d52](https://github.com/vendure-ecommerce/vendure/commit/6eb2d52)), closes [#4059](https://github.com/vendure-ecommerce/vendure/issues/4059)
* **dashboard** Move shared config for global-languages to reuse (#4024) ([e8cf3f9](https://github.com/vendure-ecommerce/vendure/commit/e8cf3f9)), closes [#4024](https://github.com/vendure-ecommerce/vendure/issues/4024)
* **dashboard** Persist user-defined column order in saved views (#3988) ([e14d562](https://github.com/vendure-ecommerce/vendure/commit/e14d562)), closes [#3988](https://github.com/vendure-ecommerce/vendure/issues/3988)
* **dashboard** Pin @lingui/swc-plugin version to fix compilation issue ([c85110a](https://github.com/vendure-ecommerce/vendure/commit/c85110a)), closes [#3929](https://github.com/vendure-ecommerce/vendure/issues/3929)
* **dashboard** Show zone regions by default ([2316b67](https://github.com/vendure-ecommerce/vendure/commit/2316b67))
* **dashboard** Sort languages by their label instead of language label (#3981) ([e503f3c](https://github.com/vendure-ecommerce/vendure/commit/e503f3c)), closes [#3981](https://github.com/vendure-ecommerce/vendure/issues/3981)
* **job-queue-plugin** Respect configured prefix in RedisJobBufferStorageStrategy (#4066) ([127b76b](https://github.com/vendure-ecommerce/vendure/commit/127b76b)), closes [#4066](https://github.com/vendure-ecommerce/vendure/issues/4066)
* **job-queue-plugin** Upgrade @google-cloud/pubsub to fix protobufjs vulnerability (#4042) ([4670d66](https://github.com/vendure-ecommerce/vendure/commit/4670d66)), closes [#4042](https://github.com/vendure-ecommerce/vendure/issues/4042)

#### Features

* **create** Add Next.js storefront option to create command (#4015) ([3713923](https://github.com/vendure-ecommerce/vendure/commit/3713923)), closes [#4015](https://github.com/vendure-ecommerce/vendure/issues/4015)
* **dashboard** Add Bulgarian (bg) translation for the Dashboard (#4001) ([090db23](https://github.com/vendure-ecommerce/vendure/commit/090db23)), closes [#4001](https://github.com/vendure-ecommerce/vendure/issues/4001)
* **dashboard** Add surcharge functionality to order modification page (#4044) ([0188735](https://github.com/vendure-ecommerce/vendure/commit/0188735)), closes [#4044](https://github.com/vendure-ecommerce/vendure/issues/4044)
* **dashboard** Implement dragging to reorder collections (#4035) ([3c47160](https://github.com/vendure-ecommerce/vendure/commit/3c47160)), closes [#4035](https://github.com/vendure-ecommerce/vendure/issues/4035)
* **dashboard** Product channel assigner (#4063) ([fbe5de2](https://github.com/vendure-ecommerce/vendure/commit/fbe5de2)), closes [#4063](https://github.com/vendure-ecommerce/vendure/issues/4063)

#### Perf

* **core** Fix slow queries when entities have self-referencing relations (#4020) ([ae93c9f](https://github.com/vendure-ecommerce/vendure/commit/ae93c9f)), closes [#4020](https://github.com/vendure-ecommerce/vendure/issues/4020)

## <small>3.5.1 (2025-11-14)</small>


#### Fixes

* **admin-ui-plugin** Deprecate `compatibilityMode` option (#3953) ([e62fce2](https://github.com/vendure-ecommerce/vendure/commit/e62fce2)), closes [#3953](https://github.com/vendure-ecommerce/vendure/issues/3953)
* **cli** Fix schema command "dir" option ([785ccf1](https://github.com/vendure-ecommerce/vendure/commit/785ccf1)), closes [#3896](https://github.com/vendure-ecommerce/vendure/issues/3896)
* **core** Correctly persist relation custom fields on Zone entity (#3951) ([c68120a](https://github.com/vendure-ecommerce/vendure/commit/c68120a)), closes [#3951](https://github.com/vendure-ecommerce/vendure/issues/3951)
* **core** Prevent duplicate GraphQL custom field input type definitions (#3889) ([f16f790](https://github.com/vendure-ecommerce/vendure/commit/f16f790)), closes [#3889](https://github.com/vendure-ecommerce/vendure/issues/3889)
* **core** Roles query pagination (#3826) ([2d1c98d](https://github.com/vendure-ecommerce/vendure/commit/2d1c98d)), closes [#3826](https://github.com/vendure-ecommerce/vendure/issues/3826)
* **create** Fix dev mode path to static dashboard files ([d0a3206](https://github.com/vendure-ecommerce/vendure/commit/d0a3206))
* **create** Update CLI instructions to reflect the new Dashboard (#3957) ([dba8f44](https://github.com/vendure-ecommerce/vendure/commit/dba8f44)), closes [#3957](https://github.com/vendure-ecommerce/vendure/issues/3957)
* **dashboard** add optional chaining to shipping lines to prevent UI from crashing (#3930) ([5e5ef68](https://github.com/vendure-ecommerce/vendure/commit/5e5ef68)), closes [#3930](https://github.com/vendure-ecommerce/vendure/issues/3930)
* **dashboard** Allow rendering multiple blocks in same location (#3937) ([1206605](https://github.com/vendure-ecommerce/vendure/commit/1206605)), closes [#3937](https://github.com/vendure-ecommerce/vendure/issues/3937)
* **dashboard** Allow the option "enableColumnFilter" for additionalColumns in ListPage (#3968) ([b9bc533](https://github.com/vendure-ecommerce/vendure/commit/b9bc533)), closes [#3968](https://github.com/vendure-ecommerce/vendure/issues/3968)
* **dashboard** Copy requiresPermission to nav menu items (#3938) ([a2057de](https://github.com/vendure-ecommerce/vendure/commit/a2057de)), closes [#3938](https://github.com/vendure-ecommerce/vendure/issues/3938)
* **dashboard** Do not block reload for pristine forms ([9a364f4](https://github.com/vendure-ecommerce/vendure/commit/9a364f4)), closes [#3964](https://github.com/vendure-ecommerce/vendure/issues/3964)
* **dashboard** Fix custom field tab display logic ([504fa9b](https://github.com/vendure-ecommerce/vendure/commit/504fa9b))
* **dashboard** Fix empty state of list type config args ([c95a00b](https://github.com/vendure-ecommerce/vendure/commit/c95a00b)), closes [#3969](https://github.com/vendure-ecommerce/vendure/issues/3969)
* **dashboard** Fix healthcheck view when api endpoint is auto (#3919) ([62d5ddb](https://github.com/vendure-ecommerce/vendure/commit/62d5ddb)), closes [#3919](https://github.com/vendure-ecommerce/vendure/issues/3919)
* **dashboard** Fix history entry item destructive icon color (#3954) ([e31e4cb](https://github.com/vendure-ecommerce/vendure/commit/e31e4cb)), closes [#3954](https://github.com/vendure-ecommerce/vendure/issues/3954)
* **dashboard** Fix incorrect currency being displayed in product variant listing (#3906) ([b2077fa](https://github.com/vendure-ecommerce/vendure/commit/b2077fa)), closes [#3906](https://github.com/vendure-ecommerce/vendure/issues/3906)
* **dashboard** Fix relation selector null/undefined handling (#3942) ([715b905](https://github.com/vendure-ecommerce/vendure/commit/715b905)), closes [#3942](https://github.com/vendure-ecommerce/vendure/issues/3942)
* **dashboard** Fix saving global languages when selecting Norwegian (#3967) ([33071cc](https://github.com/vendure-ecommerce/vendure/commit/33071cc)), closes [#3967](https://github.com/vendure-ecommerce/vendure/issues/3967)
* **dashboard** get the right vite __status on the starting page (#3891) ([521808b](https://github.com/vendure-ecommerce/vendure/commit/521808b)), closes [#3891](https://github.com/vendure-ecommerce/vendure/issues/3891)
* **dashboard** Implement bulk actions for the zone members table (#3966) ([26997d3](https://github.com/vendure-ecommerce/vendure/commit/26997d3)), closes [#3966](https://github.com/vendure-ecommerce/vendure/issues/3966) [#3927](https://github.com/vendure-ecommerce/vendure/issues/3927)
* **dashboard** Improve default string list component ([79fd8a4](https://github.com/vendure-ecommerce/vendure/commit/79fd8a4)), closes [#3916](https://github.com/vendure-ecommerce/vendure/issues/3916)
* **dashboard** Improve security of html sanitization ([4fb3bb0](https://github.com/vendure-ecommerce/vendure/commit/4fb3bb0))
* **dashboard** Include OrderLine custom fields in detail view (#3958) ([d314a6c](https://github.com/vendure-ecommerce/vendure/commit/d314a6c)), closes [#3958](https://github.com/vendure-ecommerce/vendure/issues/3958)
* **dashboard** incorrect extension import path generation on windows (#3915) ([14cd5b4](https://github.com/vendure-ecommerce/vendure/commit/14cd5b4)), closes [#3915](https://github.com/vendure-ecommerce/vendure/issues/3915)
* **dashboard** Increase rate limit for dev mode ([999d3e1](https://github.com/vendure-ecommerce/vendure/commit/999d3e1))
* **dashboard** Introduce experimental support for ESM projects ([3881d46](https://github.com/vendure-ecommerce/vendure/commit/3881d46)), closes [#3727](https://github.com/vendure-ecommerce/vendure/issues/3727) [#3533](https://github.com/vendure-ecommerce/vendure/issues/3533)
* **dashboard** Page block fixes (#3955) ([9c28eff](https://github.com/vendure-ecommerce/vendure/commit/9c28eff)), closes [#3955](https://github.com/vendure-ecommerce/vendure/issues/3955)
* **dashboard** Properly convert price to minor units before saving product variants (#3907) ([7274b23](https://github.com/vendure-ecommerce/vendure/commit/7274b23)), closes [#3907](https://github.com/vendure-ecommerce/vendure/issues/3907)
* **dashboard** Respect authTokenHeaderKey config (#3935) ([7324584](https://github.com/vendure-ecommerce/vendure/commit/7324584)), closes [#3935](https://github.com/vendure-ecommerce/vendure/issues/3935)
* **dashboard** Show customFields on address forms (#3900) ([66b2568](https://github.com/vendure-ecommerce/vendure/commit/66b2568)), closes [#3900](https://github.com/vendure-ecommerce/vendure/issues/3900)
* **payments-plugin** Support more payment flows by checking ArrangingAdditionalPayment state ([9ca67e9](https://github.com/vendure-ecommerce/vendure/commit/9ca67e9))

#### Features

* **dashboard** Support localization for dashboard extensions (#3962) ([112cb9d](https://github.com/vendure-ecommerce/vendure/commit/112cb9d)), closes [#3962](https://github.com/vendure-ecommerce/vendure/issues/3962)
* **dashboard** Tag-based input for string list custom fields (#3934) ([3fb2786](https://github.com/vendure-ecommerce/vendure/commit/3fb2786)), closes [#3934](https://github.com/vendure-ecommerce/vendure/issues/3934)

## 3.5.0 (2025-10-22)

#### Fixes

* **cli** Fix custom config path handling for migrate & schema commands ([3bfe632](https://github.com/vendure-ecommerce/vendure/commit/3bfe632))
* **cli** Fix entity generation without translation ([d8e20de](https://github.com/vendure-ecommerce/vendure/commit/d8e20de))
* **cli** Fix package location in monorepos ([39fce1c](https://github.com/vendure-ecommerce/vendure/commit/39fce1c))
* **cli** Show relative paths for duplicate plugin names in selection (#3854) ([1dafa9b](https://github.com/vendure-ecommerce/vendure/commit/1dafa9b)), closes [#3854](https://github.com/vendure-ecommerce/vendure/issues/3854)
* **cli** Update codegen command to use schema file ([9f8a3d5](https://github.com/vendure-ecommerce/vendure/commit/9f8a3d5))
* **core** Add minimums to default promotion actions/conditions ([0f95ecc](https://github.com/vendure-ecommerce/vendure/commit/0f95ecc))
* **core** Fix edge case that breaks asset url prefixing ([7b39613](https://github.com/vendure-ecommerce/vendure/commit/7b39613))
* **core** Implement min value on default shipping calculator tax ([b5f4b01](https://github.com/vendure-ecommerce/vendure/commit/b5f4b01))
* **create** Fix package resolution in monorepos ([daf85f8](https://github.com/vendure-ecommerce/vendure/commit/daf85f8))
* **dashboard** Add delete bulk action to facet value table ([6ac2edd](https://github.com/vendure-ecommerce/vendure/commit/6ac2edd))
* **dashboard** Add empty state to customer group select ([38b9f8c](https://github.com/vendure-ecommerce/vendure/commit/38b9f8c))
* **dashboard** Alerts improvements and docs (#3876) ([252eb0f](https://github.com/vendure-ecommerce/vendure/commit/252eb0f)), closes [#3876](https://github.com/vendure-ecommerce/vendure/issues/3876)
* **dashboard** Allow DateTimeInput to be cleared ([418bb27](https://github.com/vendure-ecommerce/vendure/commit/418bb27))
* **dashboard** Allow reading tsconfig files with comments ([c5c7646](https://github.com/vendure-ecommerce/vendure/commit/c5c7646))
* **dashboard** Auto generate facet value slug on create ([76aa3e2](https://github.com/vendure-ecommerce/vendure/commit/76aa3e2))
* **dashboard** Correctly display order state in all languages ([d8be8d0](https://github.com/vendure-ecommerce/vendure/commit/d8be8d0))
* **dashboard** Correctly handle object-type dashboard reference ([e4c1dab](https://github.com/vendure-ecommerce/vendure/commit/e4c1dab))
* **dashboard** Correctly reset page on filters change ([87bfd02](https://github.com/vendure-ecommerce/vendure/commit/87bfd02))
* **dashboard** Custom fields in shipping methods view were not visible (#3877) ([644ffae](https://github.com/vendure-ecommerce/vendure/commit/644ffae)), closes [#3877](https://github.com/vendure-ecommerce/vendure/issues/3877)
* **dashboard** Disable removing from default channel ([cf1479d](https://github.com/vendure-ecommerce/vendure/commit/cf1479d))
* **dashboard** Disallow negative tax rate input ([8b29d7c](https://github.com/vendure-ecommerce/vendure/commit/8b29d7c))
* **dashboard** Display MoneyInput currency per selected display locale ([0d4b797](https://github.com/vendure-ecommerce/vendure/commit/0d4b797))
* **dashboard** Display new line assets in order modification preview ([c4c851a](https://github.com/vendure-ecommerce/vendure/commit/c4c851a))
* **dashboard** Do not allow empty filters ([5d677c5](https://github.com/vendure-ecommerce/vendure/commit/5d677c5))
* **dashboard** Do not emit NaN values from number input ([3e3ab3e](https://github.com/vendure-ecommerce/vendure/commit/3e3ab3e))
* **dashboard** Enforce numeric min/max in promotions & generated inputs ([2d7f927](https://github.com/vendure-ecommerce/vendure/commit/2d7f927))
* **dashboard** Fix & localize pagination labels ([924d771](https://github.com/vendure-ecommerce/vendure/commit/924d771))
* **dashboard** Fix bg color of bulk actions select in dark mode ([6e26ac7](https://github.com/vendure-ecommerce/vendure/commit/6e26ac7))
* **dashboard** Fix boolean faceted filters ([71e2497](https://github.com/vendure-ecommerce/vendure/commit/71e2497))
* **dashboard** Fix cancellation of order modification preview ([1a6a584](https://github.com/vendure-ecommerce/vendure/commit/1a6a584))
* **dashboard** Fix cell rendering on order modification table ([4057821](https://github.com/vendure-ecommerce/vendure/commit/4057821))
* **dashboard** Fix column alignment in order table ([9ded89b](https://github.com/vendure-ecommerce/vendure/commit/9ded89b))
* **dashboard** Fix custom field error on manage variants ([006a6a9](https://github.com/vendure-ecommerce/vendure/commit/006a6a9)), closes [#3850](https://github.com/vendure-ecommerce/vendure/issues/3850)
* **dashboard** Fix customer group input ([089821d](https://github.com/vendure-ecommerce/vendure/commit/089821d)), closes [#3849](https://github.com/vendure-ecommerce/vendure/issues/3849)
* **dashboard** Fix data passed to single-row bulk action ([605de62](https://github.com/vendure-ecommerce/vendure/commit/605de62))
* **dashboard** Fix data table component overrides ([2e9f862](https://github.com/vendure-ecommerce/vendure/commit/2e9f862))
* **dashboard** Fix filtering by column with meta dependencies ([05f17d5](https://github.com/vendure-ecommerce/vendure/commit/05f17d5))
* **dashboard** Fix filtering in administrator list ([622e1a4](https://github.com/vendure-ecommerce/vendure/commit/622e1a4))
* **dashboard** Fix i18n code in admin detail ([5354c38](https://github.com/vendure-ecommerce/vendure/commit/5354c38))
* **dashboard** Fix i18n refactor errors ([860f0d5](https://github.com/vendure-ecommerce/vendure/commit/860f0d5))
* **dashboard** Fix issues with facet value table ([4f5b4ac](https://github.com/vendure-ecommerce/vendure/commit/4f5b4ac))
* **dashboard** Fix layout of move collection dialog ([b88ae8e](https://github.com/vendure-ecommerce/vendure/commit/b88ae8e))
* **dashboard** Fix missing column dependencies ([c22d74b](https://github.com/vendure-ecommerce/vendure/commit/c22d74b))
* **dashboard** Fix multi selection in asset gallery ([347b273](https://github.com/vendure-ecommerce/vendure/commit/347b273))
* **dashboard** Fix option group list display ([c646071](https://github.com/vendure-ecommerce/vendure/commit/c646071))
* **dashboard** Fix product selection in Promotion filters ([56986ae](https://github.com/vendure-ecommerce/vendure/commit/56986ae))
* **dashboard** Fix rich text editor undo/redo buttons ([6282ab3](https://github.com/vendure-ecommerce/vendure/commit/6282ab3))
* **dashboard** Fix router initialization and BASE_URL processing (#3841) ([f34e855](https://github.com/vendure-ecommerce/vendure/commit/f34e855)), closes [#3841](https://github.com/vendure-ecommerce/vendure/issues/3841)
* **dashboard** Fix selection of global languages ([0dc7e6d](https://github.com/vendure-ecommerce/vendure/commit/0dc7e6d))
* **dashboard** Fix setting custom fields on draft order ([321a6fb](https://github.com/vendure-ecommerce/vendure/commit/321a6fb))
* **dashboard** Fix setting dates in promotion detail ([76ac84c](https://github.com/vendure-ecommerce/vendure/commit/76ac84c)), closes [#3806](https://github.com/vendure-ecommerce/vendure/issues/3806)
* **dashboard** Fix setting quantities during order modification ([a92e079](https://github.com/vendure-ecommerce/vendure/commit/a92e079))
* **dashboard** Fix several issues on the list pages (#3851) ([8a5c2bb](https://github.com/vendure-ecommerce/vendure/commit/8a5c2bb)), closes [#3851](https://github.com/vendure-ecommerce/vendure/issues/3851)
* **dashboard** Fix sidebar collapsed user menu display ([0840468](https://github.com/vendure-ecommerce/vendure/commit/0840468))
* **dashboard** Fix sidebar error on hot reload ([64e47d9](https://github.com/vendure-ecommerce/vendure/commit/64e47d9))
* **dashboard** Fix slug input issues ([4d66dc7](https://github.com/vendure-ecommerce/vendure/commit/4d66dc7))
* **dashboard** Fix sort & filter on Promotion list ([676c45e](https://github.com/vendure-ecommerce/vendure/commit/676c45e))
* **dashboard** Fix spacing of customer group badges ([08f1147](https://github.com/vendure-ecommerce/vendure/commit/08f1147))
* **dashboard** Fix tax rate faceted filtering ([341085c](https://github.com/vendure-ecommerce/vendure/commit/341085c))
* **dashboard** Fix TaxRate detail default toggle ([b11869e](https://github.com/vendure-ecommerce/vendure/commit/b11869e))
* **dashboard** Fix UX of number inputs ([6645c66](https://github.com/vendure-ecommerce/vendure/commit/6645c66))
* **dashboard** Fix wrong breadcrumbs sometimes being rendered ([927c5ff](https://github.com/vendure-ecommerce/vendure/commit/927c5ff))
* **dashboard** Guard against too many items per page in data table ([4432228](https://github.com/vendure-ecommerce/vendure/commit/4432228))
* **dashboard** Handle invalid channel token in API calls ([6bc98da](https://github.com/vendure-ecommerce/vendure/commit/6bc98da))
* **dashboard** Handle NaN input in order modification table ([346a3dc](https://github.com/vendure-ecommerce/vendure/commit/346a3dc))
* **dashboard** Implement partial HMR for dashboard extensions ([930af00](https://github.com/vendure-ecommerce/vendure/commit/930af00))
* **dashboard** Improve collection preview behaviour ([2023126](https://github.com/vendure-ecommerce/vendure/commit/2023126))
* **dashboard** Improve default json display in data tables ([051a30a](https://github.com/vendure-ecommerce/vendure/commit/051a30a))
* **dashboard** Improve display of description columns ([ef828f9](https://github.com/vendure-ecommerce/vendure/commit/ef828f9))
* **dashboard** Improve facet value selector ([6e30d0c](https://github.com/vendure-ecommerce/vendure/commit/6e30d0c))
* **dashboard** Improve responsive layouts for page, data table, asset gallery ([8a76d94](https://github.com/vendure-ecommerce/vendure/commit/8a76d94))
* **dashboard** Improve responsiveness of DataTable ([87c2a08](https://github.com/vendure-ecommerce/vendure/commit/87c2a08))
* **dashboard** Improve styling of order addresses and fulfillment ([879b84e](https://github.com/vendure-ecommerce/vendure/commit/879b84e))
* **dashboard** Improve styling of order customer block ([87b43c5](https://github.com/vendure-ecommerce/vendure/commit/87b43c5))
* **dashboard** Include list options in all list queries ([a2e899e](https://github.com/vendure-ecommerce/vendure/commit/a2e899e))
* **dashboard** Make filter badges editable, improve styling ([7cf0f7e](https://github.com/vendure-ecommerce/vendure/commit/7cf0f7e))
* **dashboard** Make list filters responsive ([208f96d](https://github.com/vendure-ecommerce/vendure/commit/208f96d))
* **dashboard** Prevent creation of ShippingMethod without calculator/checker ([705975c](https://github.com/vendure-ecommerce/vendure/commit/705975c))
* **dashboard** Prevent filtering on additionalColumns ([54dbbf4](https://github.com/vendure-ecommerce/vendure/commit/54dbbf4))
* **dashboard** Remove duplicated "delete" option on product variant table ([7d6878a](https://github.com/vendure-ecommerce/vendure/commit/7d6878a))
* **dashboard** Set data table page to 1 when filter term changes ([7e9329d](https://github.com/vendure-ecommerce/vendure/commit/7e9329d))
* **dashboard** Unset addresses when changing customer for draft order ([0c52284](https://github.com/vendure-ecommerce/vendure/commit/0c52284))

#### Features

* **cli** Improve support for Nx-style monorepos ([8a83236](https://github.com/vendure-ecommerce/vendure/commit/8a83236))
* **cli** Improved monorepo detection and support ([99e0b11](https://github.com/vendure-ecommerce/vendure/commit/99e0b11))
* **cli** Introduce new `schema` command ([134e0fe](https://github.com/vendure-ecommerce/vendure/commit/134e0fe))
* **core** Add read/write permission support for settings store (#3828) ([6d585a2](https://github.com/vendure-ecommerce/vendure/commit/6d585a2)), closes [#3828](https://github.com/vendure-ecommerce/vendure/issues/3828)
* **core** Implement tax rate filtering by zoneId, categoryId ([08eb48e](https://github.com/vendure-ecommerce/vendure/commit/08eb48e))
* **create** Include Dashboard with new Vendure projects (#3862) ([b6152d5](https://github.com/vendure-ecommerce/vendure/commit/b6152d5)), closes [#3862](https://github.com/vendure-ecommerce/vendure/issues/3862)
* **dashboard** Add date range filtering to dashboard widgets (#3818) ([1643313](https://github.com/vendure-ecommerce/vendure/commit/1643313)), closes [#3818](https://github.com/vendure-ecommerce/vendure/issues/3818)
* **dashboard** Add dev mode wrapper for table columns ([2f7e321](https://github.com/vendure-ecommerce/vendure/commit/2f7e321))
* **dashboard** Add handleNestedFormSubmit utility for nested forms (#3835) ([ced9371](https://github.com/vendure-ecommerce/vendure/commit/ced9371)), closes [#3835](https://github.com/vendure-ecommerce/vendure/issues/3835)
* **dashboard** Add link to parent product from variant detail ([0320150](https://github.com/vendure-ecommerce/vendure/commit/0320150))
* **dashboard** Add page size controls to asset list ([8dc3c92](https://github.com/vendure-ecommerce/vendure/commit/8dc3c92))
* **dashboard** Add rebuild search index button ([c162135](https://github.com/vendure-ecommerce/vendure/commit/c162135))
* **dashboard** Add saved views for data tables (#3825) ([afdc37c](https://github.com/vendure-ecommerce/vendure/commit/afdc37c)), closes [#3825](https://github.com/vendure-ecommerce/vendure/issues/3825)
* **dashboard** Add stock level controls for multiple locations ([516b0ff](https://github.com/vendure-ecommerce/vendure/commit/516b0ff))
* **dashboard** Add storybook app for dashboard components (#3879) ([dcf8516](https://github.com/vendure-ecommerce/vendure/commit/dcf8516)), closes [#3879](https://github.com/vendure-ecommerce/vendure/issues/3879)
* **dashboard** Add subtle fade in on blocks ([18125fd](https://github.com/vendure-ecommerce/vendure/commit/18125fd))
* **dashboard** Add support for multiple currency prices ([34ace59](https://github.com/vendure-ecommerce/vendure/commit/34ace59))
* **dashboard** Add TanStack Router `validateSearch` support and unauthenticated routes (#3840) ([00628dd](https://github.com/vendure-ecommerce/vendure/commit/00628dd)), closes [#3840](https://github.com/vendure-ecommerce/vendure/issues/3840)
* **dashboard** Default dashboard page & dx improvements (#3859) ([1ad5250](https://github.com/vendure-ecommerce/vendure/commit/1ad5250)), closes [#3859](https://github.com/vendure-ecommerce/vendure/issues/3859)
* **dashboard** Display Tanstack query devtools only in devMode ([1a4e188](https://github.com/vendure-ecommerce/vendure/commit/1a4e188))
* **dashboard** Enable filtering products & variants by SKU ([dc7cabf](https://github.com/vendure-ecommerce/vendure/commit/dc7cabf))
* **dashboard** Full localization for 25 languages (#3847) ([6c85b28](https://github.com/vendure-ecommerce/vendure/commit/6c85b28)), closes [#3847](https://github.com/vendure-ecommerce/vendure/issues/3847)
* **dashboard** Implement add command for Dashboard extensions (#3864) ([8c23593](https://github.com/vendure-ecommerce/vendure/commit/8c23593)), closes [#3864](https://github.com/vendure-ecommerce/vendure/issues/3864)
* **dashboard** Implement option group & option editing (#3837) ([226d14f](https://github.com/vendure-ecommerce/vendure/commit/226d14f)), closes [#3837](https://github.com/vendure-ecommerce/vendure/issues/3837)
* **dashboard** Support bearer token auth ([b9d2686](https://github.com/vendure-ecommerce/vendure/commit/b9d2686))
* **dashboard** Support conditional rendering of page blocks ([a83ed37](https://github.com/vendure-ecommerce/vendure/commit/a83ed37))
* **sentry-plugin** Add option to capture logs ([7777721](https://github.com/vendure-ecommerce/vendure/commit/7777721))
* **sentry-plugin** Log error instead of throw error when dsn is not set ([0bd9ea6](https://github.com/vendure-ecommerce/vendure/commit/0bd9ea6))
* **sentry-plugin** Migrate to @sentry/nestjs module (#3744) ([0a60889](https://github.com/vendure-ecommerce/vendure/commit/0a60889)), closes [#3744](https://github.com/vendure-ecommerce/vendure/issues/3744)

#### Perf

* **dashboard** Optimize list queries (#3838) ([8709fda](https://github.com/vendure-ecommerce/vendure/commit/8709fda)), closes [#3838](https://github.com/vendure-ecommerce/vendure/issues/3838)


### BREAKING CHANGE

* We have updated the underlying library used in our `@vendure/sentry-plugin` package, bringing it up to the latest version. This also impacts the way that the sentry plugin is configured - see the release notes for details.
## <small>3.4.4 (2025-10-08)</small>


#### Fixes

* **core** Omit saving Order.customFields on applyPriceAdjustments ([293a74b](https://github.com/vendure-ecommerce/vendure/commit/293a74b))
* **create** Fix package resolution in monorepos ([7590b56](https://github.com/vendure-ecommerce/vendure/commit/7590b56))

## <small>3.4.3 (2025-10-02)</small>


#### Fixes

* **core** Ensure `surcharges` relation is loaded in assignToChannels (#3812) ([9d58978](https://github.com/vendure-ecommerce/vendure/commit/9d58978)), closes [#3812](https://github.com/vendure-ecommerce/vendure/issues/3812)
* **core** Set apollo dependency to fix hung install ([28a9831](https://github.com/vendure-ecommerce/vendure/commit/28a9831))
* **dashboard** Add bulk actions to product variants table ([c3f1d1b](https://github.com/vendure-ecommerce/vendure/commit/c3f1d1b))
* **dashboard** Add missing columns to product variants table ([0577e24](https://github.com/vendure-ecommerce/vendure/commit/0577e24))
* **dashboard** Clear temp dir on compilation ([a0bbe09](https://github.com/vendure-ecommerce/vendure/commit/a0bbe09))
* **dashboard** Fix asset detail preview display ([03b03ac](https://github.com/vendure-ecommerce/vendure/commit/03b03ac))
* **dashboard** Fix asset focal point positioning ([d574be4](https://github.com/vendure-ecommerce/vendure/commit/d574be4))
* **dashboard** Fix display of collection children column ([946409d](https://github.com/vendure-ecommerce/vendure/commit/946409d))
* **dashboard** Fix position of bulk actions when in sheet ([2902e30](https://github.com/vendure-ecommerce/vendure/commit/2902e30))
* **dashboard** Fix runtime issue caused by dependency bundling ([7d3b2b4](https://github.com/vendure-ecommerce/vendure/commit/7d3b2b4))
* **dashboard** Implement entity duplicator dialog ([0328d46](https://github.com/vendure-ecommerce/vendure/commit/0328d46))
* **dashboard** Improve layout of permissions grid (#3827) ([5c3ae0f](https://github.com/vendure-ecommerce/vendure/commit/5c3ae0f)), closes [#3827](https://github.com/vendure-ecommerce/vendure/issues/3827)

#### Features

* **dashboard** Add entity info dropdown to page action bar (#3819) ([98fd82d](https://github.com/vendure-ecommerce/vendure/commit/98fd82d)), closes [#3819](https://github.com/vendure-ecommerce/vendure/issues/3819)
* **dashboard** Add support for Asset tags (#3822) ([5c6967f](https://github.com/vendure-ecommerce/vendure/commit/5c6967f)), closes [#3822](https://github.com/vendure-ecommerce/vendure/issues/3822)
* **dashboard** Add support for custom history entries (#3831) ([1db50a6](https://github.com/vendure-ecommerce/vendure/commit/1db50a6)), closes [#3831](https://github.com/vendure-ecommerce/vendure/issues/3831)
* **dashboard** Dashboard permissions on nav menu & custom fields (#3824) ([b95ad17](https://github.com/vendure-ecommerce/vendure/commit/b95ad17)), closes [#3824](https://github.com/vendure-ecommerce/vendure/issues/3824)
* **dashboard** Expose bulk actions per row in data tables (#3820) ([de79737](https://github.com/vendure-ecommerce/vendure/commit/de79737)), closes [#3820](https://github.com/vendure-ecommerce/vendure/issues/3820)
* **dashboard** Implement meta title based on breadcrumb (#3834) ([cb0463d](https://github.com/vendure-ecommerce/vendure/commit/cb0463d)), closes [#3834](https://github.com/vendure-ecommerce/vendure/issues/3834)
* **dashboard** Implement testing of shipping methods (#3833) ([a0df5be](https://github.com/vendure-ecommerce/vendure/commit/a0df5be)), closes [#3833](https://github.com/vendure-ecommerce/vendure/issues/3833)
* **dashboard** Improve toolbar display of rich text editor (#3817) ([9b15ecc](https://github.com/vendure-ecommerce/vendure/commit/9b15ecc)), closes [#3817](https://github.com/vendure-ecommerce/vendure/issues/3817)
* **dashboard** Support for split orders (#3829) ([f31c386](https://github.com/vendure-ecommerce/vendure/commit/f31c386)), closes [#3829](https://github.com/vendure-ecommerce/vendure/issues/3829)

## <small>3.4.2 (2025-09-11)</small>


#### Fixes

* **core** Correctly implement SettingsStore validation & argument order (#3808) ([d8cdd62](https://github.com/vendure-ecommerce/vendure/commit/d8cdd62)), closes [#3808](https://github.com/vendure-ecommerce/vendure/issues/3808)
* **core** Emit `CollectionEvent` after moving a collection (#3801) ([d80e28f](https://github.com/vendure-ecommerce/vendure/commit/d80e28f)), closes [#3801](https://github.com/vendure-ecommerce/vendure/issues/3801)
* **core** Fix logic for calculating interval ([394fb05](https://github.com/vendure-ecommerce/vendure/commit/394fb05))
* **core** Handle foreign key violations during order merge (#3795) ([c00a044](https://github.com/vendure-ecommerce/vendure/commit/c00a044)), closes [#3795](https://github.com/vendure-ecommerce/vendure/issues/3795)
* **core** Log warning when attempting to persist invalid custom fields (#3793) ([eefbd9c](https://github.com/vendure-ecommerce/vendure/commit/eefbd9c)), closes [#3793](https://github.com/vendure-ecommerce/vendure/issues/3793)
* **core** Handle stale locks on scheduled tasks (#3708) ([4492850](https://github.com/vendure-ecommerce/vendure/commit/4492850)), closes [#3708](https://github.com/vendure-ecommerce/vendure/issues/3708)
* **create** Fix resolving path in repos using hoisted node_modules (#3802) ([fd971a5](https://github.com/vendure-ecommerce/vendure/commit/fd971a5)), closes [#3802](https://github.com/vendure-ecommerce/vendure/issues/3802)
* **dashboard** Add initial value to reduce call ([9261f03](https://github.com/vendure-ecommerce/vendure/commit/9261f03))
* **dashboard** Allow column selection on recent orders ([182c0b7](https://github.com/vendure-ecommerce/vendure/commit/182c0b7))
* **dashboard** Derive breadcrumbs from path/basepath to match sidebar (#3784) ([562cc54](https://github.com/vendure-ecommerce/vendure/commit/562cc54)), closes [#3784](https://github.com/vendure-ecommerce/vendure/issues/3784)
* **dashboard** Ensure language is valid when switching channel ([97d9a9d](https://github.com/vendure-ecommerce/vendure/commit/97d9a9d)), closes [#3780](https://github.com/vendure-ecommerce/vendure/issues/3780)
* **dashboard** Ensure language is valid when switching channel ([7473956](https://github.com/vendure-ecommerce/vendure/commit/7473956))
* **dashboard** Fix api 'auto' options (#3807) ([b597dfc](https://github.com/vendure-ecommerce/vendure/commit/b597dfc)), closes [#3807](https://github.com/vendure-ecommerce/vendure/issues/3807)
* **dashboard** Fix change detection in RichTextInput ([1c18b41](https://github.com/vendure-ecommerce/vendure/commit/1c18b41))
* **dashboard** Fix checkboxes on variant creation ([4b69839](https://github.com/vendure-ecommerce/vendure/commit/4b69839))
* **dashboard** Fix data table date filter ([225b774](https://github.com/vendure-ecommerce/vendure/commit/225b774))
* **dashboard** Fix filtering in latest orders widget ([b8ac456](https://github.com/vendure-ecommerce/vendure/commit/b8ac456))
* **dashboard** Fix multi select on asset gallery ([5826c7f](https://github.com/vendure-ecommerce/vendure/commit/5826c7f))
* **dashboard** Fix navigation to Asset detail from gallery dialog ([846ab24](https://github.com/vendure-ecommerce/vendure/commit/846ab24))
* **dashboard** Fix scroll behaviour on asset picker dialog ([363043d](https://github.com/vendure-ecommerce/vendure/commit/363043d))
* **dashboard** Improve facet list table ([b76d1dc](https://github.com/vendure-ecommerce/vendure/commit/b76d1dc))
* **dashboard** Improve layout & rendering of order summary widget ([cf72c72](https://github.com/vendure-ecommerce/vendure/commit/cf72c72))
* **dashboard** Improve styling of metrics widget, add refresh ([e8f8d99](https://github.com/vendure-ecommerce/vendure/commit/e8f8d99))
* **dashboard** Make long table column dropdowns scrollable ([f878e24](https://github.com/vendure-ecommerce/vendure/commit/f878e24))
* **dashboard** Show “Create” for new entities, “Update” for edits (#3805) ([fdece02](https://github.com/vendure-ecommerce/vendure/commit/fdece02)), closes [#3805](https://github.com/vendure-ecommerce/vendure/issues/3805)
* **dashboard** Update channel switcher when Channel added/updated ([1cd7652](https://github.com/vendure-ecommerce/vendure/commit/1cd7652))

Note: In this release, the `SettingsStoreService` methods have been revised to put the
`ctx` argument in the first position, as is standard across Vendure APIs. Existing code
with the ctx last will still work, but you are advised to update it.

```diff
- SettingsStoreService.get<T>(key, ctx)       
- SettingsStoreService.getMany(keys, ctx)     
- SettingsStoreService.set<T>(key, value, ctx)
- SettingsStoreService.setMany(values, ctx)

+ SettingsStoreService.get<T>(ctx, key)       
+ SettingsStoreService.getMany(ctx, keys)     
+ SettingsStoreService.set<T>(ctx, key, value)
+ SettingsStoreService.setMany(ctx, values)   
```

#### Features

* **dashboard** Add manage variants screen ([cdfd4ca](https://github.com/vendure-ecommerce/vendure/commit/cdfd4ca))

## <small>3.4.1 (2025-08-25)</small>


#### Fixes

* **admin-ui** Fixed facets and tags references in Spanish translations (#3752) ([bc8bbea](https://github.com/vendure-ecommerce/vendure/commit/bc8bbea)), closes [#3752](https://github.com/vendure-ecommerce/vendure/issues/3752)
* **cli** Use dynamic import for strip-json-comments (#3745) ([a3acd91](https://github.com/vendure-ecommerce/vendure/commit/a3acd91)), closes [#3745](https://github.com/vendure-ecommerce/vendure/issues/3745)
* **core** Filter StockMovements by type when fetching by product variant (#3713) ([99907fc](https://github.com/vendure-ecommerce/vendure/commit/99907fc)), closes [#3713](https://github.com/vendure-ecommerce/vendure/issues/3713)
* **core** Fix scheduled task registration to avoid entity ID errors (#3763) ([68e98eb](https://github.com/vendure-ecommerce/vendure/commit/68e98eb)), closes [#3763](https://github.com/vendure-ecommerce/vendure/issues/3763)
* **dashboard** Add error handling to schema generation process (#3731) ([23ef906](https://github.com/vendure-ecommerce/vendure/commit/23ef906)), closes [#3731](https://github.com/vendure-ecommerce/vendure/issues/3731)
* **dashboard** Remove bulk actions display in asset picker ([55f71ab](https://github.com/vendure-ecommerce/vendure/commit/55f71ab))
* **dashboard** Remove vite plugin source code from package ([c3546c4](https://github.com/vendure-ecommerce/vendure/commit/c3546c4))
* **email-plugin** Escape recipient's HTML entities in dev mailbox (#3756) ([904baa9](https://github.com/vendure-ecommerce/vendure/commit/904baa9)), closes [#3756](https://github.com/vendure-ecommerce/vendure/issues/3756)
* **job-queue-plugin** Use SCAN instead of KEYS to clean indexed sets (#3743) ([1c9b00b](https://github.com/vendure-ecommerce/vendure/commit/1c9b00b)), closes [#3743](https://github.com/vendure-ecommerce/vendure/issues/3743)

## 3.4.0 (2025-08-01)


#### Fixes

* **cli** Standardise flag names ([a63ac07](https://github.com/vendure-ecommerce/vendure/commit/a63ac07))
* **core** Fix relation constraints in OrderModification ([87fc929](https://github.com/vendure-ecommerce/vendure/commit/87fc929))
* **core** Product by slug query filters on channel (#3591) ([78608cc](https://github.com/vendure-ecommerce/vendure/commit/78608cc)), closes [#3591](https://github.com/vendure-ecommerce/vendure/issues/3591)
* **dashboard** Add "ring offeset" padding on devmode on hover ring (#3707) ([a2e3a10](https://github.com/vendure-ecommerce/vendure/commit/a2e3a10)), closes [#3707](https://github.com/vendure-ecommerce/vendure/issues/3707)
* **dashboard** Add missing order property to nav menu items (#3705) ([6ffa048](https://github.com/vendure-ecommerce/vendure/commit/6ffa048)), closes [#3705](https://github.com/vendure-ecommerce/vendure/issues/3705)
* **dashboard** Fix detection of node_modules ([55e012b](https://github.com/vendure-ecommerce/vendure/commit/55e012b))
* **dashboard** Fix dev mode styling in dark mode ([092b432](https://github.com/vendure-ecommerce/vendure/commit/092b432))
* **dashboard** Fix editing of order history entries ([74f149a](https://github.com/vendure-ecommerce/vendure/commit/74f149a))
* **dashboard** Fix heading for collection contents ([971ecca](https://github.com/vendure-ecommerce/vendure/commit/971ecca))
* **dashboard** Fix intersecting borders and inconsistent rounded corners (#3717) ([ae7828f](https://github.com/vendure-ecommerce/vendure/commit/ae7828f)), closes [#3717](https://github.com/vendure-ecommerce/vendure/issues/3717)
* **dashboard** Improved facet value editing ([16c2e5e](https://github.com/vendure-ecommerce/vendure/commit/16c2e5e))
* **dashboard** Multiple style & functionality fixes ([cca25e2](https://github.com/vendure-ecommerce/vendure/commit/cca25e2))
* **dashboard** Remove use of crypto.randomUUID in option input (#3618) ([61bed48](https://github.com/vendure-ecommerce/vendure/commit/61bed48)), closes [#3618](https://github.com/vendure-ecommerce/vendure/issues/3618)
* **payments-plugin** improve order state transition handling for channel-specific contexts and default channel as a fallback (#3420) ([4f29f0a](https://github.com/vendure-ecommerce/vendure/commit/4f29f0a)), closes [#3420](https://github.com/vendure-ecommerce/vendure/issues/3420)

#### Features

* **cli** Non-interactive mode and new structure (#3606) ([7d9f03b](https://github.com/vendure-ecommerce/vendure/commit/7d9f03b)), closes [#3606](https://github.com/vendure-ecommerce/vendure/issues/3606)
* **core** Add `addItemsToOrder` mutation to add multiple items to cart (#3500) ([84a8cbe](https://github.com/vendure-ecommerce/vendure/commit/84a8cbe)), closes [#3500](https://github.com/vendure-ecommerce/vendure/issues/3500)
* **core** Add facetValue query to Admin API ([fae3c51](https://github.com/vendure-ecommerce/vendure/commit/fae3c51))
* **core** Add single facetValue create/update mutations to Admin API ([4db0d51](https://github.com/vendure-ecommerce/vendure/commit/4db0d51))
* **core** Add support for deprecating custom fields with @deprecated directive (#3582) ([6fb399f](https://github.com/vendure-ecommerce/vendure/commit/6fb399f)), closes [#3582](https://github.com/vendure-ecommerce/vendure/issues/3582)
* **core** Add trustProxy option to ApiOptions (#3567) ([f248719](https://github.com/vendure-ecommerce/vendure/commit/f248719)), closes [#3567](https://github.com/vendure-ecommerce/vendure/issues/3567)
* **core** Improve OrderEvent and publish for order modify (#3594) ([5a27b14](https://github.com/vendure-ecommerce/vendure/commit/5a27b14)), closes [#3594](https://github.com/vendure-ecommerce/vendure/issues/3594)
* **core** Merge custom fields on updating order lines (#3673) ([ead7bfa](https://github.com/vendure-ecommerce/vendure/commit/ead7bfa)), closes [#3673](https://github.com/vendure-ecommerce/vendure/issues/3673)
* **core** SettingsStore for global & scoped config settings (#3684) ([5aa01cc](https://github.com/vendure-ecommerce/vendure/commit/5aa01cc)), closes [#3684](https://github.com/vendure-ecommerce/vendure/issues/3684)
* **core** Throw error on taxSummary if surcharges relation is not loaded (#3569) ([068176c](https://github.com/vendure-ecommerce/vendure/commit/068176c)), closes [#3569](https://github.com/vendure-ecommerce/vendure/issues/3569)
* **dashboard** Add customizable login extensions API (#3704) ([866afcb](https://github.com/vendure-ecommerce/vendure/commit/866afcb)), closes [#3704](https://github.com/vendure-ecommerce/vendure/issues/3704)
* **dashboard** Add DashboardPlugin as part of dashboard package (#3711) ([49d449f](https://github.com/vendure-ecommerce/vendure/commit/49d449f)), closes [#3711](https://github.com/vendure-ecommerce/vendure/issues/3711)
* **dashboard** Add dev mode info to nav menu ([867655e](https://github.com/vendure-ecommerce/vendure/commit/867655e))
* **dashboard** Dashboard persistent settings (#3712) ([17c27ff](https://github.com/vendure-ecommerce/vendure/commit/17c27ff)), closes [#3712](https://github.com/vendure-ecommerce/vendure/issues/3712)
* **dashboard** Implement content language handling ([b635d23](https://github.com/vendure-ecommerce/vendure/commit/b635d23))
* **elasticsearch-plugin** Extend ElasticSearch to also support groupBySKU for multi-vendor store scenarios (#3528) ([ec1cc5e](https://github.com/vendure-ecommerce/vendure/commit/ec1cc5e)), closes [#3528](https://github.com/vendure-ecommerce/vendure/issues/3528)
* **payments-plugin** Export StripeService to support more payment flows (#3624) ([829ab2c](https://github.com/vendure-ecommerce/vendure/commit/829ab2c)), closes [#3624](https://github.com/vendure-ecommerce/vendure/issues/3624)
* **payments-plugin** Migrate Mollie to Payments API (#3603) ([d0db5cb](https://github.com/vendure-ecommerce/vendure/commit/d0db5cb)), closes [#3603](https://github.com/vendure-ecommerce/vendure/issues/3603)

#### Perf

* **core** Add indexes on date cols for orders & job items (#3614) ([ceb5279](https://github.com/vendure-ecommerce/vendure/commit/ceb5279)), closes [#3614](https://github.com/vendure-ecommerce/vendure/issues/3614)


### BREAKING CHANGE

* If you are using the `MolliePlugin`, you should install @mollie/api-client@4.3.3 as the plugin has been updated to use the latest Mollie features.
* Indexes have been added on the columns `orderPlacedAt` in the Order table, and `createdAt` in the JobItem table (for those using the DefaultJobQueuePlugin). This will require a non-destructive DB migration be performed to add these indexes to your schema. 
* With the introduction of the new SettingsStore feature, a non-destructive database migration will be required to set up the new table that will store the settings data.
## <small>3.3.8 (2025-08-01)</small>


#### Fixes

* **admin-ui** Fixed tracking code not showing in order history (#3402) ([6002c21](https://github.com/vendure-ecommerce/vendure/commit/6002c21)), closes [#3402](https://github.com/vendure-ecommerce/vendure/issues/3402)
* **cli** Replace regex solution with robust stirp-json-comments package (#3694) ([26a9e03](https://github.com/vendure-ecommerce/vendure/commit/26a9e03)), closes [#3694](https://github.com/vendure-ecommerce/vendure/issues/3694)
* **core** Account for refund status when calculating order coverage (#3719) ([1400bbc](https://github.com/vendure-ecommerce/vendure/commit/1400bbc)), closes [#3719](https://github.com/vendure-ecommerce/vendure/issues/3719) [#3670](https://github.com/vendure-ecommerce/vendure/issues/3670)
* **core** More reliable job subscriber timeout handling ([5e124d5](https://github.com/vendure-ecommerce/vendure/commit/5e124d5))
* **dashboard** Correct detection of tailwind classes in plugins ([86da88a](https://github.com/vendure-ecommerce/vendure/commit/86da88a))
* **dashboard** Fix custom field label ([45d4b3c](https://github.com/vendure-ecommerce/vendure/commit/45d4b3c))
* **dashboard** Fix custom fields in GlobalSettings detail ([bcd55b8](https://github.com/vendure-ecommerce/vendure/commit/bcd55b8))
* **dashboard** Fix npm package discovery ([1fc6f85](https://github.com/vendure-ecommerce/vendure/commit/1fc6f85))
* **dashboard** Fix plugin detection on Windows ([bbb8c48](https://github.com/vendure-ecommerce/vendure/commit/bbb8c48))
* **dashboard** Temporarily remove shadcn avatar ([10d5ebc](https://github.com/vendure-ecommerce/vendure/commit/10d5ebc))
* **email-plugin** Hydrate lines.featureAsset on order-confirmation email (#3690) ([20c05db](https://github.com/vendure-ecommerce/vendure/commit/20c05db)), closes [#3690](https://github.com/vendure-ecommerce/vendure/issues/3690)
* **payments-plugin** Include metadata in createPayment of Stripe handler (#3692) ([d415dd0](https://github.com/vendure-ecommerce/vendure/commit/d415dd0)), closes [#3692](https://github.com/vendure-ecommerce/vendure/issues/3692)

#### Features

* **dashboard** Full support for configurable operations UI (#3702) ([8e0c5b4](https://github.com/vendure-ecommerce/vendure/commit/8e0c5b4)), closes [#3702](https://github.com/vendure-ecommerce/vendure/issues/3702)
* **dashboard** Full support for custom fields in detail forms (#3695) ([38d6f73](https://github.com/vendure-ecommerce/vendure/commit/38d6f73)), closes [#3695](https://github.com/vendure-ecommerce/vendure/issues/3695)
* **dashboard** Implement add facet value ([4b24f24](https://github.com/vendure-ecommerce/vendure/commit/4b24f24))
* **dashboard** Implement delete facet value ([c7db965](https://github.com/vendure-ecommerce/vendure/commit/c7db965))
* **dashboard** Job list improvements ([d5c39cf](https://github.com/vendure-ecommerce/vendure/commit/d5c39cf))
* **dashboard** Update theme to use OKLCH color space and new shadcn theme (#3688) ([199cbd1](https://github.com/vendure-ecommerce/vendure/commit/199cbd1)), closes [#3688](https://github.com/vendure-ecommerce/vendure/issues/3688)

## <small>3.3.7 (2025-07-18)</small>


#### Fixes

* **core** Apply custom field defaults on entity creation (#3674) ([65804ba](https://github.com/vendure-ecommerce/vendure/commit/65804ba)), closes [#3674](https://github.com/vendure-ecommerce/vendure/issues/3674)
* **core** Correct unfulfilled quantity calc for multiple fulfillment lines per orderline (#3647) ([430dcb8](https://github.com/vendure-ecommerce/vendure/commit/430dcb8)), closes [#3647](https://github.com/vendure-ecommerce/vendure/issues/3647)
* **core** ID decoding in nested filter structures (#3677) ([b2c3bc9](https://github.com/vendure-ecommerce/vendure/commit/b2c3bc9)), closes [#3677](https://github.com/vendure-ecommerce/vendure/issues/3677)
* **dashboard** Fix handling of more types of path alias (#3678) ([c9f993f](https://github.com/vendure-ecommerce/vendure/commit/c9f993f)), closes [#3678](https://github.com/vendure-ecommerce/vendure/issues/3678)

## <small>3.3.6 (2025-07-14)</small>


#### Fixes

* **admin-ui** Better Spanish translation for "locale" (#3664) ([12b6a4d](https://github.com/vendure-ecommerce/vendure/commit/12b6a4d)), closes [#3664](https://github.com/vendure-ecommerce/vendure/issues/3664)
* **admin-ui** Respect visibility setting when creating a new collection (#3650) ([cda91df](https://github.com/vendure-ecommerce/vendure/commit/cda91df)), closes [#3650](https://github.com/vendure-ecommerce/vendure/issues/3650)
* **admin-ui** update button class for consistency in action bar (#3625) ([32c261a](https://github.com/vendure-ecommerce/vendure/commit/32c261a)), closes [#3625](https://github.com/vendure-ecommerce/vendure/issues/3625)
* **cli** Create new instance of entity before saving to db in generated Entity (#3623) ([8a2e679](https://github.com/vendure-ecommerce/vendure/commit/8a2e679)), closes [#3623](https://github.com/vendure-ecommerce/vendure/issues/3623)
* **core** Export missing common utilities in index files (#3665) ([4551eb9](https://github.com/vendure-ecommerce/vendure/commit/4551eb9)), closes [#3665](https://github.com/vendure-ecommerce/vendure/issues/3665)
* **core** Handle fs-capacitor readstream creation error (#3646) ([73902ee](https://github.com/vendure-ecommerce/vendure/commit/73902ee)), closes [#3646](https://github.com/vendure-ecommerce/vendure/issues/3646)
* **core** Remove unused variable in removeVariantFromChannel (#3661) ([8b28ae8](https://github.com/vendure-ecommerce/vendure/commit/8b28ae8)), closes [#3661](https://github.com/vendure-ecommerce/vendure/issues/3661)
* **dashboard** Correct import path for RichTextInput component ([462708a](https://github.com/vendure-ecommerce/vendure/commit/462708a))
* **dashboard** Fix bad imports ([9a43255](https://github.com/vendure-ecommerce/vendure/commit/9a43255))
* **dashboard** Fix creation of new entities using UUID ids ([b56cefe](https://github.com/vendure-ecommerce/vendure/commit/b56cefe)), closes [#3658](https://github.com/vendure-ecommerce/vendure/issues/3658)
* **dashboard** Fix dashboard bulk action hook imports (#3640) ([969e1a1](https://github.com/vendure-ecommerce/vendure/commit/969e1a1)), closes [#3640](https://github.com/vendure-ecommerce/vendure/issues/3640)
* **dashboard** Fix race condition causing customField error ([78555cb](https://github.com/vendure-ecommerce/vendure/commit/78555cb))
* **dashboard** Fix redirect after creating new product ([5ea9ad8](https://github.com/vendure-ecommerce/vendure/commit/5ea9ad8))
* **dashboard** Fix saving new entities when using UUIDs ([d880112](https://github.com/vendure-ecommerce/vendure/commit/d880112)), closes [#3616](https://github.com/vendure-ecommerce/vendure/issues/3616)
* **dashboard** Fix tanstack router config for utils dir ([40f1ca3](https://github.com/vendure-ecommerce/vendure/commit/40f1ca3))
* **dashboard** Form control rendering ([436c7b9](https://github.com/vendure-ecommerce/vendure/commit/436c7b9))
* **dashboard** Handle list relation custom fields properly ([622ed04](https://github.com/vendure-ecommerce/vendure/commit/622ed04))
* **dashboard** Improve single and multi-select handling in relation selector ([807d055](https://github.com/vendure-ecommerce/vendure/commit/807d055))
* **dashboard** Improve styling of bulk select dropdown (#3635) ([8efcaed](https://github.com/vendure-ecommerce/vendure/commit/8efcaed)), closes [#3635](https://github.com/vendure-ecommerce/vendure/issues/3635)
* **dashboard** Make variant detail breadcrumbs context-aware ([07c174c](https://github.com/vendure-ecommerce/vendure/commit/07c174c))
* **dashboard** Remove duplicate export ([c4ed056](https://github.com/vendure-ecommerce/vendure/commit/c4ed056))
* **dashboard** Update imports in hooks to fix typings ([cd450ed](https://github.com/vendure-ecommerce/vendure/commit/cd450ed))
* **dashboard** Update Money component to use 'currency' prop  (#3644) ([aa517a6](https://github.com/vendure-ecommerce/vendure/commit/aa517a6)), closes [#3644](https://github.com/vendure-ecommerce/vendure/issues/3644)
* **dashboard** Use dedicated @/vdb alias for imports (#3631) ([a3d7f05](https://github.com/vendure-ecommerce/vendure/commit/a3d7f05)), closes [#3631](https://github.com/vendure-ecommerce/vendure/issues/3631)

#### Features

* **dashboard** Add custom ID filtering and fetching for relation selector ([1bdc8cb](https://github.com/vendure-ecommerce/vendure/commit/1bdc8cb))
* **dashboard** Allow override of all detail form inputs (#3642) ([bce0ec9](https://github.com/vendure-ecommerce/vendure/commit/bce0ec9)), closes [#3642](https://github.com/vendure-ecommerce/vendure/issues/3642)
* **dashboard** Enhance detail forms extension API with input and display components  (#3626) ([e6def00](https://github.com/vendure-ecommerce/vendure/commit/e6def00)), closes [#3626](https://github.com/vendure-ecommerce/vendure/issues/3626)
* **dashboard** Implement API to extend detail page queries ([e83ad3b](https://github.com/vendure-ecommerce/vendure/commit/e83ad3b))
* **dashboard** Implement bulk actions for collections ([b85c7a5](https://github.com/vendure-ecommerce/vendure/commit/b85c7a5))
* **dashboard** Implement collection channel bulk actions ([332e6e2](https://github.com/vendure-ecommerce/vendure/commit/332e6e2))
* **dashboard** Implement extension of list query documents ([5190e4f](https://github.com/vendure-ecommerce/vendure/commit/5190e4f))
* **dashboard** Implement product variant bulk actions ([2f651b2](https://github.com/vendure-ecommerce/vendure/commit/2f651b2))
* **dashboard** Implement remaining bulk actions (#3627) ([13989b9](https://github.com/vendure-ecommerce/vendure/commit/13989b9)), closes [#3627](https://github.com/vendure-ecommerce/vendure/issues/3627)
* **dashboard** Move collections UI (#3629) ([a921e97](https://github.com/vendure-ecommerce/vendure/commit/a921e97)), closes [#3629](https://github.com/vendure-ecommerce/vendure/issues/3629)
* **dashboard** Order detail missing features (#3636) ([183b8f3](https://github.com/vendure-ecommerce/vendure/commit/183b8f3)), closes [#3636](https://github.com/vendure-ecommerce/vendure/issues/3636)
* **dashboard** Order modification (#3656) ([8a15d89](https://github.com/vendure-ecommerce/vendure/commit/8a15d89)), closes [#3656](https://github.com/vendure-ecommerce/vendure/issues/3656)
* **dashboard** Relation selector components (#3633) ([d648ac1](https://github.com/vendure-ecommerce/vendure/commit/d648ac1)), closes [#3633](https://github.com/vendure-ecommerce/vendure/issues/3633)
* **dashboard** Support compilation of external plugins (#3663) ([e445bdb](https://github.com/vendure-ecommerce/vendure/commit/e445bdb)), closes [#3663](https://github.com/vendure-ecommerce/vendure/issues/3663)

#### Perf

* **core** Optimize relation loading strategies for orders and order lines (#3652) ([a04b94a](https://github.com/vendure-ecommerce/vendure/commit/a04b94a)), closes [#3652](https://github.com/vendure-ecommerce/vendure/issues/3652)

## <small>3.3.5 (2025-06-27)</small>

#### Fixes

* **core** Only use shipping address for tax zone determination (#3367) ([8977d9f](https://github.com/vendure-ecommerce/vendure/commit/8977d9f)), closes [#3367](https://github.com/vendure-ecommerce/vendure/issues/3367)
* **cli** Allow comments in tsconfig for the migrate command (#3604) ([957c5e8](https://github.com/vendure-ecommerce/vendure/commit/957c5e8)), closes [#3604](https://github.com/vendure-ecommerce/vendure/issues/3604)
* **dashboard** Add order property to navigation items for improved sorting ([82a1b7f](https://github.com/vendure-ecommerce/vendure/commit/82a1b7f))
* **dashboard** Enable tailwind processing of dashboard extension files ([694d0dd](https://github.com/vendure-ecommerce/vendure/commit/694d0dd))
* **dashboard** Fix asset imports in built index.html ([3ad6634](https://github.com/vendure-ecommerce/vendure/commit/3ad6634))
* **dashboard** Fix bulk editing of product facet values ([943b71f](https://github.com/vendure-ecommerce/vendure/commit/943b71f))
* **dashboard** Fix extension loading on Windows ([bbaa3e9](https://github.com/vendure-ecommerce/vendure/commit/bbaa3e9)), closes [#3593](https://github.com/vendure-ecommerce/vendure/issues/3593)
* **dashboard** Fix handling of Vite base option ([f21a0b6](https://github.com/vendure-ecommerce/vendure/commit/f21a0b6))
* **dashboard** Fix plugin detection from barrel files ([aa12ac7](https://github.com/vendure-ecommerce/vendure/commit/aa12ac7))
* **dashboard** Improve data table loading UX ([2227598](https://github.com/vendure-ecommerce/vendure/commit/2227598))
* **dashboard** Only transform base path in build phase ([3a031b3](https://github.com/vendure-ecommerce/vendure/commit/3a031b3))
* **dashboard** Update Vite plugin output directory to 'dist' for consistency ([8526da9](https://github.com/vendure-ecommerce/vendure/commit/8526da9))
* **email-plugin** Fix Dynamic smtp config require server restart to reflect changes (#3282) ([d6d967d](https://github.com/vendure-ecommerce/vendure/commit/d6d967d)), closes [#3282](https://github.com/vendure-ecommerce/vendure/issues/3282)
* **job-queue-plugin** Correctly list running jobs ([391e314](https://github.com/vendure-ecommerce/vendure/commit/391e314))
* **job-queue-plugin** Do not throw on unknown job state ([bb91f26](https://github.com/vendure-ecommerce/vendure/commit/bb91f26))

#### Features

* **dashboard** Add entity prop to detail pages for improved context ([4c20cae](https://github.com/vendure-ecommerce/vendure/commit/4c20cae))
* **dashboard** Add relation field transformation (#3619) ([caa18ac](https://github.com/vendure-ecommerce/vendure/commit/caa18ac)), closes [#3619](https://github.com/vendure-ecommerce/vendure/issues/3619)
* **dashboard** Add support for monorepo setups ([76759d9](https://github.com/vendure-ecommerce/vendure/commit/76759d9))
* **dashboard** Confirmation on deletion from list views ([d88a0a7](https://github.com/vendure-ecommerce/vendure/commit/d88a0a7))
* **dashboard** Custom form components for custom fields (#3610) ([155f376](https://github.com/vendure-ecommerce/vendure/commit/155f376)), closes [#3610](https://github.com/vendure-ecommerce/vendure/issues/3610)
* **dashboard** Dashboard bulk actions (#3615) ([39edc18](https://github.com/vendure-ecommerce/vendure/commit/39edc18)), closes [#3615](https://github.com/vendure-ecommerce/vendure/issues/3615)
* **dashboard** Implement tabbed interface for custom fields in forms ([68af675](https://github.com/vendure-ecommerce/vendure/commit/68af675))
* **dashboard** Improve display of variant stock levels in lists ([1ce87ed](https://github.com/vendure-ecommerce/vendure/commit/1ce87ed))
* **dashboard** Respect base path of Vite config in router ([7716ece](https://github.com/vendure-ecommerce/vendure/commit/7716ece))

## <small>3.3.4 (2025-06-19)</small>

#### Fixes

* **core** Add missing peer deps and docs (#3595) ([36cf92b](https://github.com/vendure-ecommerce/vendure/commit/36cf92b)), closes [#3595](https://github.com/vendure-ecommerce/vendure/issues/3595)
* **core** Call OrderInterceptor `willRemoveItemFromOrder` on `removeAllItemsFromOrder` (#3578) (#3592) ([6c239bf](https://github.com/vendure-ecommerce/vendure/commit/6c239bf)), closes [#3578](https://github.com/vendure-ecommerce/vendure/issues/3578) [#3592](https://github.com/vendure-ecommerce/vendure/issues/3592)
* **core** Further stability improvement to default scheduler ([664b919](https://github.com/vendure-ecommerce/vendure/commit/664b919))
* **core** Improve fault-tolerance of default scheduler ([852cdce](https://github.com/vendure-ecommerce/vendure/commit/852cdce))
* **core** Improve ProductOptionGroup soft-delete handling (#3581) ([95d9417](https://github.com/vendure-ecommerce/vendure/commit/95d9417)), closes [#3581](https://github.com/vendure-ecommerce/vendure/issues/3581)
* **core** Product by slug query filters on channel (#3591) ([357de30](https://github.com/vendure-ecommerce/vendure/commit/357de30)), closes [#3591](https://github.com/vendure-ecommerce/vendure/issues/3591)
* **core** Safer access to queryRunner in transactions ([5beb2fe](https://github.com/vendure-ecommerce/vendure/commit/5beb2fe)), closes [#3565](https://github.com/vendure-ecommerce/vendure/issues/3565)
* **dashboard** Allow customization of custom field columns (#3597) ([f42085b](https://github.com/vendure-ecommerce/vendure/commit/f42085b)), closes [#3597](https://github.com/vendure-ecommerce/vendure/issues/3597)
* **dashboard** Fix bug preventing login screen from rendering ([cc77ddf](https://github.com/vendure-ecommerce/vendure/commit/cc77ddf))

#### Features

* **dashboard** Custom nav sections (#3598) ([cbc0409](https://github.com/vendure-ecommerce/vendure/commit/cbc0409)), closes [#3598](https://github.com/vendure-ecommerce/vendure/issues/3598)
* **dashboard** Enhance Vite plugin configuration for build output management ([257bc03](https://github.com/vendure-ecommerce/vendure/commit/257bc03))
* **dashboard** Support for custom fields in detail page component (#3599) ([32314cc](https://github.com/vendure-ecommerce/vendure/commit/32314cc)), closes [#3599](https://github.com/vendure-ecommerce/vendure/issues/3599)

#### Perf

* **job-queue-plugin** Optimize list query for BullMQJobQueuePlugin (#3590) ([208b87a](https://github.com/vendure-ecommerce/vendure/commit/208b87a)), closes [#3590](https://github.com/vendure-ecommerce/vendure/issues/3590)

## <small>3.3.3 (2025-06-06)</small>

#### Fixes

* **admin-ui** Make product / variant cols link to detail pages in order table (#3552) ([0fda452](https://github.com/vendure-ecommerce/vendure/commit/0fda452)), closes [#3552](https://github.com/vendure-ecommerce/vendure/issues/3552)
* **core** Export OrderableAsset (#3571) ([e17aaf6](https://github.com/vendure-ecommerce/vendure/commit/e17aaf6)), closes [#3571](https://github.com/vendure-ecommerce/vendure/issues/3571)
* **core** Include custom fields on `activePaymentMethods` and `activeShippingMethods` queries (#3513) ([bb4723d](https://github.com/vendure-ecommerce/vendure/commit/bb4723d)), closes [#3513](https://github.com/vendure-ecommerce/vendure/issues/3513)
* **core** Update @nestjs/* packages version constraint (#3577) ([1a8eece](https://github.com/vendure-ecommerce/vendure/commit/1a8eece)), closes [#3577](https://github.com/vendure-ecommerce/vendure/issues/3577)
* **dashboard** Do not throw on compilation errors by default ([b1df849](https://github.com/vendure-ecommerce/vendure/commit/b1df849))
* **dashboard** Fix admin auth & channel selection bugs (#3562) ([3b9c090](https://github.com/vendure-ecommerce/vendure/commit/3b9c090)), closes [#3562](https://github.com/vendure-ecommerce/vendure/issues/3562)
* **dashboard** Fix default channel list columns ([c552aa5](https://github.com/vendure-ecommerce/vendure/commit/c552aa5))
* **dashboard** Fix default column order ([1e1dc8e](https://github.com/vendure-ecommerce/vendure/commit/1e1dc8e))
* **dashboard** Fix default column visibility ([029dd31](https://github.com/vendure-ecommerce/vendure/commit/029dd31))
* **dashboard** Fix issue with form not being marked dirty until second interaction ([604cf4f](https://github.com/vendure-ecommerce/vendure/commit/604cf4f))
* **dashboard** Fix loading of server config on page refresh ([66a7977](https://github.com/vendure-ecommerce/vendure/commit/66a7977))
* **dashboard** Fix positioning of toasts ([38785e7](https://github.com/vendure-ecommerce/vendure/commit/38785e7))
* **dashboard** Fix render issues for asset & facet blocks ([e14c457](https://github.com/vendure-ecommerce/vendure/commit/e14c457))
* **dashboard** Improve responsiveness of form state ([21dc4bf](https://github.com/vendure-ecommerce/vendure/commit/21dc4bf))
* **dashboard** Improve styling of channel switcher ([829513c](https://github.com/vendure-ecommerce/vendure/commit/829513c))

#### Features

* **dashboard** Add reset button for data table columns ([5877ef5](https://github.com/vendure-ecommerce/vendure/commit/5877ef5))
* **dashboard** Implement adding new variants & product options ([7646a4a](https://github.com/vendure-ecommerce/vendure/commit/7646a4a))

## <small>3.3.2 (2025-05-28)</small>

#### Fixes

* **core** Create spans for method calls within same class (#3564) ([a2721d1](https://github.com/vendure-ecommerce/vendure/commit/a2721d1)), closes [#3564](https://github.com/vendure-ecommerce/vendure/issues/3564)
* **core** Enhance error handling for Error instances in logger (#3561) ([a580e88](https://github.com/vendure-ecommerce/vendure/commit/a580e88)), closes [#3561](https://github.com/vendure-ecommerce/vendure/issues/3561)
* **dashboard** Authenticated status race condition (#3554) ([58ac01b](https://github.com/vendure-ecommerce/vendure/commit/58ac01b)), closes [#3554](https://github.com/vendure-ecommerce/vendure/issues/3554)
* **dashboard** Fetch channel info on login ([81f6659](https://github.com/vendure-ecommerce/vendure/commit/81f6659))

## <small>3.3.1 (2025-05-20)</small>

#### Fixes

* **admin-ui** Improve Arabic translations (#3531) ([dbd3c65](https://github.com/vendure-ecommerce/vendure/commit/dbd3c65)), closes [#3531](https://github.com/vendure-ecommerce/vendure/issues/3531)
* **admin-ui** Update French translations from (#3525) ([d03bc2b](https://github.com/vendure-ecommerce/vendure/commit/d03bc2b)), closes [#3525](https://github.com/vendure-ecommerce/vendure/issues/3525)
* **core)** Use job alias for clean-jobs task by (#3537) https://github.com/vendure-ecommerce/vendure/pull/3537
* **core** Fix circular merge-deep stack overflow issue (#3549) ([bdc3438](https://github.com/vendure-ecommerce/vendure/commit/bdc3438)), closes [#3549](https://github.com/vendure-ecommerce/vendure/issues/3549)
* **dashboard** Fix padding on pages ([fc27608](https://github.com/vendure-ecommerce/vendure/commit/fc27608))
* **graphiql-plugin** Fix asset path for pnpm ([882a055](https://github.com/vendure-ecommerce/vendure/commit/882a055)), closes [#3499](https://github.com/vendure-ecommerce/vendure/issues/3499)
* **payments-plugin** Enable use of "klarna" payment via Mollie (#3538) ([6313d0f](https://github.com/vendure-ecommerce/vendure/commit/6313d0f)), closes [#3538](https://github.com/vendure-ecommerce/vendure/issues/3538)
* **telemetry-plugin** Fix compatibility range ([ac0528d](https://github.com/vendure-ecommerce/vendure/commit/ac0528d))
* **testing** Await outstanding jobs before populating test data (#3544) ([cc32ce7](https://github.com/vendure-ecommerce/vendure/commit/cc32ce7)), closes [#3544](https://github.com/vendure-ecommerce/vendure/issues/3544)

## 3.3.0 (2025-05-12)

#### Fixes

* **dashboard** Fix checkbox on DetailPage ([f32d66d](https://github.com/vendure-ecommerce/vendure/commit/f32d66d))
* **dashboard** Fix Page component not rendering when used externally ([3322fa1](https://github.com/vendure-ecommerce/vendure/commit/3322fa1))
* **dashboard** Fix some form validation issues ([e811e99](https://github.com/vendure-ecommerce/vendure/commit/e811e99))
* **dashboard** Fix some small issues with extensions, add docs ([7dca28c](https://github.com/vendure-ecommerce/vendure/commit/7dca28c))
* **dashboard** Fix types for dashboard extensions ([c6ade27](https://github.com/vendure-ecommerce/vendure/commit/c6ade27))
* **dashboard** Improve DetailPage component ([c4c93a0](https://github.com/vendure-ecommerce/vendure/commit/c4c93a0))
* **dashboard** Preserve Vite alias settings if set ([d79ea77](https://github.com/vendure-ecommerce/vendure/commit/d79ea77))
* **dashboard** Prevent navigation blocker on creating entity ([b5851d5](https://github.com/vendure-ecommerce/vendure/commit/b5851d5))

#### Features

* **telemetry-plugin** Add new `@vendure/telemetry-plugin` package
* **graphiql-plugin** Add new `@vendure/graphiql-plugin` package
* **admin-ui** Manual triggering of scheduled tasks ([76d74e1](https://github.com/vendure-ecommerce/vendure/commit/76d74e1)), closes [#1425](https://github.com/vendure-ecommerce/vendure/issues/1425)
* **core** Add scheduled task to clean up jobs from the DB ([ed28280](https://github.com/vendure-ecommerce/vendure/commit/ed28280))
* **core** Allow manual triggering of scheduled tasks ([2a89b2a](https://github.com/vendure-ecommerce/vendure/commit/2a89b2a)), closes [#1425](https://github.com/vendure-ecommerce/vendure/issues/1425)
* **core** Apply Instrumentation to all services & key helper classes ([4b3f526](https://github.com/vendure-ecommerce/vendure/commit/4b3f526))
* **core** Enhance cache service and SQL cache strategy with tracing support ([374db42](https://github.com/vendure-ecommerce/vendure/commit/374db42))
* **core** Enhance scheduled task execution with RequestContext ([c0b5902](https://github.com/vendure-ecommerce/vendure/commit/c0b5902))
* **core** Integrate tracing into ConfigService for enhanced custom fields logging ([195132f](https://github.com/vendure-ecommerce/vendure/commit/195132f))
* **core** Tracing for job-queue ([7a27428](https://github.com/vendure-ecommerce/vendure/commit/7a27428))
* **core** Update tracing in AppModule to enhance middleware configuration logging ([596846c](https://github.com/vendure-ecommerce/vendure/commit/596846c))
* **create** Update default tsconfig ([ee40c50](https://github.com/vendure-ecommerce/vendure/commit/ee40c50))
* **dashboard** Add refresh button to data tables ([891ff15](https://github.com/vendure-ecommerce/vendure/commit/891ff15))
* **dashboard** Implement alert system with customizable alerts ([13c8969](https://github.com/vendure-ecommerce/vendure/commit/13c8969))
* **dashboard** Manual triggering of scheduled tasks ([226730e](https://github.com/vendure-ecommerce/vendure/commit/226730e)), closes [#1425](https://github.com/vendure-ecommerce/vendure/issues/1425)

## <small>3.2.4 (2025-05-05)</small>

#### Fixes

* **admin-ui-plugin** Fix issue with sendFile and absolute paths (#3499) ([62664cb](https://github.com/vendure-ecommerce/vendure/commit/62664cb)), closes [#3499](https://github.com/vendure-ecommerce/vendure/issues/3499)
* **admin-ui-plugin** Fix proxy-middleware v2 to v3 issue (#3507) ([ae20be1](https://github.com/vendure-ecommerce/vendure/commit/ae20be1)), closes [#3507](https://github.com/vendure-ecommerce/vendure/issues/3507)
* **admin-ui-plugin** proxy target template string (#3514) ([8e6a991](https://github.com/vendure-ecommerce/vendure/commit/8e6a991)), closes [#3514](https://github.com/vendure-ecommerce/vendure/issues/3514)
* **admin-ui** Relax rxjs dependency version ([01b7375](https://github.com/vendure-ecommerce/vendure/commit/01b7375))
* **core** Detect circular reference in collection ancestor tree ([c427d8e](https://github.com/vendure-ecommerce/vendure/commit/c427d8e))
* **core** Enhance password validation strategy with maxLength option and set default maxLength ([fbd3a94](https://github.com/vendure-ecommerce/vendure/commit/fbd3a94))
* **core** Fix PaginatedList filtering by calculated property ([7966978](https://github.com/vendure-ecommerce/vendure/commit/7966978))
* **dashboard** Fix several issues related to login/logout ([7b3b917](https://github.com/vendure-ecommerce/vendure/commit/7b3b917))
* **dashboard** Fix some issues on order list/detail pages ([fe0ceb4](https://github.com/vendure-ecommerce/vendure/commit/fe0ceb4))
* **dashboard** Improve compatibility of config loading ([7cb3624](https://github.com/vendure-ecommerce/vendure/commit/7cb3624))

## <small>3.2.3 (2025-04-17)</small>

#### Fixes

* **admin-ui** Fix missing product variant list tab ([047eaa5](https://github.com/vendure-ecommerce/vendure/commit/047eaa5))
* **core** Align Express & types versions ([ba4111b](https://github.com/vendure-ecommerce/vendure/commit/ba4111b))
* **core** Relax some express typings to prevent v4/v5 types conflicts ([97e53d5](https://github.com/vendure-ecommerce/vendure/commit/97e53d5))

## <small>3.2.2 (2025-04-03)</small>

#### Fixes

* **dashboard** Fix dashboard plugin publishing ([65281e5f](https://github.com/vendure-ecommerce/vendure/commit/65281e5f))

## <small>3.2.1 (2025-04-03)</small>

#### Fixes

* **job-queue-plugin** Respect custom prefix for BullMQ Redis keys ([40f1cb8](https://github.com/vendure-ecommerce/vendure/commit/40f1cb8))
* **ui-devkit** Silence sass warnings during compilation ([724e849](https://github.com/vendure-ecommerce/vendure/commit/724e849))
* **ui-devkit** Update angular.json for v19 compatibility ([1ac69a7](https://github.com/vendure-ecommerce/vendure/commit/1ac69a7))

## 3.2.0 (2025-04-02)

#### Fixes

* **admin-ui** Fix build error ([fbbcc3e](https://github.com/vendure-ecommerce/vendure/commit/fbbcc3e))
* **admin-ui** Fix incorrect pagination range (#3404) ([1ee2d45](https://github.com/vendure-ecommerce/vendure/commit/1ee2d45)), closes [#3404](https://github.com/vendure-ecommerce/vendure/issues/3404)
* **core** Avoid variant options combination check on updateProductVariant mutation (#3361) ([c820f42](https://github.com/vendure-ecommerce/vendure/commit/c820f42)), closes [#3361](https://github.com/vendure-ecommerce/vendure/issues/3361)
* **core** Fix progress reporting for collection filters job ([3976148](https://github.com/vendure-ecommerce/vendure/commit/3976148))
* **core** Use correct precision for CacheItem.expiresAt ([12e2db0](https://github.com/vendure-ecommerce/vendure/commit/12e2db0))

#### Features

* **admin-ui** Add Japanese UI translations (#3400) ([d24964a](https://github.com/vendure-ecommerce/vendure/commit/d24964a)), closes [#3400](https://github.com/vendure-ecommerce/vendure/issues/3400)
* **common** Add exports field to package.json for module resolution ([5623c2b](https://github.com/vendure-ecommerce/vendure/commit/5623c2b))
* **core** Add two new queries to get public payment and shipping methods ([1aa75d5](https://github.com/vendure-ecommerce/vendure/commit/1aa75d5))
* **core** Add two new queries to get public payment and shipping methods ([5c7fe42](https://github.com/vendure-ecommerce/vendure/commit/5c7fe42))
* **core** Add updateProductVariant mutation ([0b854b4](https://github.com/vendure-ecommerce/vendure/commit/0b854b4))
* **core** Add verification token strategy (#3294) ([9375ba2](https://github.com/vendure-ecommerce/vendure/commit/9375ba2)), closes [#3294](https://github.com/vendure-ecommerce/vendure/issues/3294)
* **core** Update all major dependencies (#3445) ([d376d83](https://github.com/vendure-ecommerce/vendure/commit/d376d83)), closes [#3445](https://github.com/vendure-ecommerce/vendure/issues/3445)
* **harden-plugin** Allow skipping complexity check in Harden Plugin (#3340) ([0bef00b](https://github.com/vendure-ecommerce/vendure/commit/0bef00b)), closes [#3340](https://github.com/vendure-ecommerce/vendure/issues/3340)
* **job-queue-plugin** Add support for job options Priority ([90b5e05](https://github.com/vendure-ecommerce/vendure/commit/90b5e05))

#### Perf

* **core** Remove duplicated calls to promotion checks ([e3508f3](https://github.com/vendure-ecommerce/vendure/commit/e3508f3))

### BREAKING CHANGE

* If you are using the DefaultCachePlugin, then
  you should generate a migration that adds `precision(3)` to the
  `expiresAt` column. This will only affect cache records so no prod
  data will be affected by it.

## <small>3.1.8 (2025-03-31)</small>

#### Fixes

* **admin-ui** Fix product variant list location (#3410) ([5082cc9](https://github.com/vendure-ecommerce/vendure/commit/5082cc9)), closes [#3410](https://github.com/vendure-ecommerce/vendure/issues/3410)
* **core** Eligible payment methods must be enabled (#3406) ([45852ea](https://github.com/vendure-ecommerce/vendure/commit/45852ea)), closes [#3406](https://github.com/vendure-ecommerce/vendure/issues/3406)
* **job-queue-plugin** Fix ignored values from BullMQ workerOptions (#3440) ([a9aea24](https://github.com/vendure-ecommerce/vendure/commit/a9aea24)), closes [#3440](https://github.com/vendure-ecommerce/vendure/issues/3440)

## <small>3.1.7 (2025-03-06)</small>

#### Fixes

* **admin-ui** Fix broken Collection list & Order detail views ([6a5bb90](https://github.com/vendure-ecommerce/vendure/commit/6a5bb90)), fixes regression from [#3368](https://github.com/vendure-ecommerce/vendure/issues/3368)

## <small>3.1.6 (2025-03-06)</small>

#### Fixes

* **core** Fix FastImporterService when using stockOnHand ([f97484c](https://github.com/vendure-ecommerce/vendure/commit/f97484c)), fixes regression from [#3288](https://github.com/vendure-ecommerce/vendure/issues/3288)

## <small>3.1.5 (2025-03-06)</small>

#### Fixes

* **admin-ui** Fix incorrect tracking id on ProductOption's / ProductOption list per page switch (#3368) ([33cfea6](https://github.com/vendure-ecommerce/vendure/commit/33cfea6)), closes [#3368](https://github.com/vendure-ecommerce/vendure/issues/3368)
* **core** Fix fast-importer-service stock location (#3288) ([59d6447](https://github.com/vendure-ecommerce/vendure/commit/59d6447)), closes [#3288](https://github.com/vendure-ecommerce/vendure/issues/3288)
* **core** Fix order cancellation when shipping has tax (#3393) ([e753df9](https://github.com/vendure-ecommerce/vendure/commit/e753df9)), closes [#3393](https://github.com/vendure-ecommerce/vendure/issues/3393)
* **core** Fix server crash when subscribable job times out ([7f851c3](https://github.com/vendure-ecommerce/vendure/commit/7f851c3)), closes [#3397](https://github.com/vendure-ecommerce/vendure/issues/3397)

## <small>3.1.4 (2025-02-28)</small>

#### Fixes

* **admin-ui** Fix app crash when user has unknown locale ([a4c1de2](https://github.com/vendure-ecommerce/vendure/commit/a4c1de2)), closes [#3362](https://github.com/vendure-ecommerce/vendure/issues/3362)
* **core** Do not return deleted ProductOptionGroups (#3363) ([1df1b7f](https://github.com/vendure-ecommerce/vendure/commit/1df1b7f)), closes [#3363](https://github.com/vendure-ecommerce/vendure/issues/3363)
* **core** Fix progress reporting for collection filters job ([eaa8eb6](https://github.com/vendure-ecommerce/vendure/commit/eaa8eb6))
* **core** Fix struct custom field support on GlobalSettings ([50a90e7](https://github.com/vendure-ecommerce/vendure/commit/50a90e7)), closes [#3381](https://github.com/vendure-ecommerce/vendure/issues/3381)
* **core** Add missing "enabled" flag to CreateProductVariant input (#3377) ([f5a0f99](https://github.com/vendure-ecommerce/vendure/commit/f5a0f99)), closes [#3377](https://github.com/vendure-ecommerce/vendure/issues/3377)

#### Perf

* **core** Remove duplicated calls to promotion checks ([4407488](https://github.com/vendure-ecommerce/vendure/commit/4407488))

## <small>3.1.3 (2025-02-14)</small>

#### Fixes

* **admin-ui** Improve display of OrderLine custom fields in form ([4e92d85](https://github.com/vendure-ecommerce/vendure/commit/4e92d85))
* **core** Allow non-public customOrderLineFields in admin api (#3357) ([becfe9d](https://github.com/vendure-ecommerce/vendure/commit/becfe9d)), closes [#3357](https://github.com/vendure-ecommerce/vendure/issues/3357)
* **core** Fix undefined type issue with nested fragment spreads (#3351) ([d0c0454](https://github.com/vendure-ecommerce/vendure/commit/d0c0454)), closes [#3351](https://github.com/vendure-ecommerce/vendure/issues/3351)

#### Perf

* **core** Optimize payload of apply-collection-filters job ([4157033](https://github.com/vendure-ecommerce/vendure/commit/4157033))
* **core** Optimize payload size for buffered jobs in DB ([f81a908](https://github.com/vendure-ecommerce/vendure/commit/f81a908))
* **job-queue-plugin** Optimize payload size for buffered jobs in Redis ([7c72352](https://github.com/vendure-ecommerce/vendure/commit/7c72352))

## <small>3.1.2 (2025-01-22)</small>

#### Fixes

* **admin-ui** Add support for mac command key for selection manager (#3315) ([c1cfb737](https://github.com/vendure-ecommerce/vendure/commit/c1cfb737))
* **admin-ui** Add ProductVariantPrice custom fields ui inputs (#3327) ([0d22b25](https://github.com/vendure-ecommerce/vendure/commit/0d22b25)), closes [#3327](https://github.com/vendure-ecommerce/vendure/issues/3327)
* **admin-ui** Update Polish localization (#3309) ([82787cf](https://github.com/vendure-ecommerce/vendure/commit/82787cf)), closes [#3309](https://github.com/vendure-ecommerce/vendure/issues/3309)
* **common** Contract multiple sequential replacers to just one in normalizeString (#3289) ([f362a4b](https://github.com/vendure-ecommerce/vendure/commit/f362a4b)), closes [#3289](https://github.com/vendure-ecommerce/vendure/issues/3289)
* **core** Clear previous line adjustments before testing order item promotions (#3320) ([c970dea](https://github.com/vendure-ecommerce/vendure/commit/c970dea)), closes [#3320](https://github.com/vendure-ecommerce/vendure/issues/3320)
* **core** Fix schema error with readonly Address custom field ([1bddbcc](https://github.com/vendure-ecommerce/vendure/commit/1bddbcc)), closes [#3326](https://github.com/vendure-ecommerce/vendure/issues/3326)
* **core** Improvements to Redis cache plugin (#3303) ([b631781](https://github.com/vendure-ecommerce/vendure/commit/b631781)), closes [#3303](https://github.com/vendure-ecommerce/vendure/issues/3303)
* **core** Include variant custom fields when duplicating a product (#3203) ([69a1de0](https://github.com/vendure-ecommerce/vendure/commit/69a1de0)), closes [#3203](https://github.com/vendure-ecommerce/vendure/issues/3203)
* **create** Specify Typesense Docker image version ([fd6a9fd](https://github.com/vendure-ecommerce/vendure/commit/fd6a9fd))
* **elasticsearch-plugin** Improve search results (#3284) ([b8112be0](https://github.com/vendure-ecommerce/vendure/commit/b8112be0))
* **payments-plugin** Fix null access error in BraintreePlugin ([627d930](https://github.com/vendure-ecommerce/vendure/commit/627d930))
* **payments-plugin** Stripe plugin supports correct languageCode (#3298) ([4349ef8](https://github.com/vendure-ecommerce/vendure/commit/4349ef8)), closes [#3298](https://github.com/vendure-ecommerce/vendure/issues/3298)

## <small>3.1.1 (2024-12-17)</small>

#### Fixes

* **asset-server-plugin** Correctly handle EXIF rotation on source files (#3260) ([d606d7a](https://github.com/vendure-ecommerce/vendure/commit/d606d7a)), closes [#3260](https://github.com/vendure-ecommerce/vendure/issues/3260) [#3259](https://github.com/vendure-ecommerce/vendure/issues/3259)
* **core** Fix circular reference error in email sending job ([02bcdba](https://github.com/vendure-ecommerce/vendure/commit/02bcdba)), closes [#3277](https://github.com/vendure-ecommerce/vendure/issues/3277)
* **core** Fix serialization of ShippingMethod ([0c122bc](https://github.com/vendure-ecommerce/vendure/commit/0c122bc)), closes [#3277](https://github.com/vendure-ecommerce/vendure/issues/3277)

## 3.1.0 (2024-12-04)

#### Features

* **admin-ui** Improve facet selector with the code (#3175) ([35892a5](https://github.com/vendure-ecommerce/vendure/commit/35892a5)), closes [#3175](https://github.com/vendure-ecommerce/vendure/issues/3175)
* **admin-ui** Integrate Vendure Assets Picker with ProseMirror and add single image selection (#3033) ([18e5ab9](https://github.com/vendure-ecommerce/vendure/commit/18e5ab9)), closes [#3033](https://github.com/vendure-ecommerce/vendure/issues/3033)
* **admin-ui** Set default shipping and billing address for draft orders (#3196) ([dec72e7](https://github.com/vendure-ecommerce/vendure/commit/dec72e7)), closes [#3196](https://github.com/vendure-ecommerce/vendure/issues/3196) [#2342](https://github.com/vendure-ecommerce/vendure/issues/2342)
* **asset-server-plugin** Implement ImageTransformStrategy for improved control over image transformations (#3240) ([dde738d](https://github.com/vendure-ecommerce/vendure/commit/dde738d)), closes [#3240](https://github.com/vendure-ecommerce/vendure/issues/3240) [#3040](https://github.com/vendure-ecommerce/vendure/issues/3040)
* **core** Add custom field support for Payment, Refund, ShippingLine, StockLevel, StockMovement, Session, HistoryEntry ([1167102](https://github.com/vendure-ecommerce/vendure/commit/1167102)), closes [#3044](https://github.com/vendure-ecommerce/vendure/issues/3044)
* **core** Add means to selectively ignore plugin compatibility errors ([e362475](https://github.com/vendure-ecommerce/vendure/commit/e362475)), closes [#2958](https://github.com/vendure-ecommerce/vendure/issues/2958)
* **core** Add OrderInterceptor API (#3233) ([7706e35](https://github.com/vendure-ecommerce/vendure/commit/7706e35)), closes [#3233](https://github.com/vendure-ecommerce/vendure/issues/3233) [#2123](https://github.com/vendure-ecommerce/vendure/issues/2123)
* **core** Add replicationMode for ctx and getRepository (#2746) ([60cdae3](https://github.com/vendure-ecommerce/vendure/commit/60cdae3)), closes [#2746](https://github.com/vendure-ecommerce/vendure/issues/2746)
* **core** Add StockLocationEvent ([5cff832](https://github.com/vendure-ecommerce/vendure/commit/5cff832))
* **core** Allow unsetting of shipping and billing addresses (#3185) ([e0f2118](https://github.com/vendure-ecommerce/vendure/commit/e0f2118)), closes [#3185](https://github.com/vendure-ecommerce/vendure/issues/3185)
* **core** Create a user from external authentication (#3005) ([bb28d70](https://github.com/vendure-ecommerce/vendure/commit/bb28d70)), closes [#3005](https://github.com/vendure-ecommerce/vendure/issues/3005)
* **core** Create Cache class for a more convenient caching API ([a7ceb74](https://github.com/vendure-ecommerce/vendure/commit/a7ceb74)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Create PromotionLineAction (#2971) ([0ff8288](https://github.com/vendure-ecommerce/vendure/commit/0ff8288)), closes [#2971](https://github.com/vendure-ecommerce/vendure/issues/2971) [#2956](https://github.com/vendure-ecommerce/vendure/issues/2956)
* **core** Enable hydration of translations relation ([84710d5](https://github.com/vendure-ecommerce/vendure/commit/84710d5))
* **core** Implement bulk versions of order operations ([8d65219](https://github.com/vendure-ecommerce/vendure/commit/8d65219))
* **core** Implement cache invalidation by tags ([382e314](https://github.com/vendure-ecommerce/vendure/commit/382e314)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Implement CacheStrategy and CacheService ([489c9c0](https://github.com/vendure-ecommerce/vendure/commit/489c9c0)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Implement caching for FacetValueChecker ([3603b11](https://github.com/vendure-ecommerce/vendure/commit/3603b11)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Implement redis cache plugin ([9d99593](https://github.com/vendure-ecommerce/vendure/commit/9d99593)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Implement support for struct custom field type (#3178) ([dffd123](https://github.com/vendure-ecommerce/vendure/commit/dffd123)), closes [#3178](https://github.com/vendure-ecommerce/vendure/issues/3178)
* **core** Include address-based tax zone strategy (#3198) ([5547128](https://github.com/vendure-ecommerce/vendure/commit/5547128)), closes [#3198](https://github.com/vendure-ecommerce/vendure/issues/3198)
* **core** Initial DefaultCachePlugin implementation ([9c2433f](https://github.com/vendure-ecommerce/vendure/commit/9c2433f)), closes [#3043](https://github.com/vendure-ecommerce/vendure/issues/3043)
* **core** Introduce new default MultiChannelStockLocationStrategy ([62090c9](https://github.com/vendure-ecommerce/vendure/commit/62090c9)), closes [#2356](https://github.com/vendure-ecommerce/vendure/issues/2356)
* **email-plugin** Allow specifying metadata for EmailSendEvent (#2963) ([ac0baf9](https://github.com/vendure-ecommerce/vendure/commit/ac0baf9)), closes [#2963](https://github.com/vendure-ecommerce/vendure/issues/2963)
* **payments-plugin** Add option to StripePlugin to handle payment intent that doesn't have Vendure metadata (#3250) ([ec934dd](https://github.com/vendure-ecommerce/vendure/commit/ec934dd)), closes [#3250](https://github.com/vendure-ecommerce/vendure/issues/3250)
* **payments-plugin** Allow additional options on Stripe payment intent creation (#3194) ([3f66216](https://github.com/vendure-ecommerce/vendure/commit/3f66216)), closes [#3194](https://github.com/vendure-ecommerce/vendure/issues/3194)

#### Fixes

* **admin-ui** Only update facetValueIds if changed ([8f22ef8](https://github.com/vendure-ecommerce/vendure/commit/8f22ef8))
* **core** Fix error in FacetValueChecker on nullish input ([44aad49](https://github.com/vendure-ecommerce/vendure/commit/44aad49))
* **core** Fix error with new session cache when seeding data ([508f797](https://github.com/vendure-ecommerce/vendure/commit/508f797))
* **core** Update DefaultMoneyStrategy.round() Logic (#3023) ([f43c204](https://github.com/vendure-ecommerce/vendure/commit/f43c204)), closes [#3023](https://github.com/vendure-ecommerce/vendure/issues/3023)

#### Perf

* **core** Improve efficiency of order merge ([0a60ee9](https://github.com/vendure-ecommerce/vendure/commit/0a60ee9))

### BREAKING CHANGE

* A technically breaking change in this release is that we have corrected the default rounding logic:

```ts
// v3.0
return Math.round(value) * quantity;

// v3.1
return Math.round(value * quantity);
```

This makes order totals calculations much more "correct" as per most people's expectations, but it pointed out as a technically breaking change in the unlikely event that you rely on the old, less correct method of rounding.

* If you are using the `FacetValueChecker` utility class, you should
  update your code to get it via the `Injector` rather than directly instantiating it.

Existing code _will_ still work without changes, but by updating you will see improved
performance due to new caching techniques.

```diff
- facetValueChecker = new FacetValueChecker(injector.get(TransactionalConnection));
+ facetValueChecker = injector.get(FacetValueChecker);
```

## <small>3.0.8 (2024-12-03)</small>

#### Fixes

* **admin-ui** Fix adding country to zone dialog ([22eaf6c](https://github.com/vendure-ecommerce/vendure/commit/22eaf6c)), closes [#3212](https://github.com/vendure-ecommerce/vendure/issues/3212)

## <small>3.0.7 (2024-12-02)</small>

#### Fixes

* **admin-ui** Preset filters preserve query parameters (#3176) ([7a25bef](https://github.com/vendure-ecommerce/vendure/commit/7a25bef)), closes [#3176](https://github.com/vendure-ecommerce/vendure/issues/3176)
* **asset-server-plugin** Fix issues with s3/minio file retrieval ([8545267](https://github.com/vendure-ecommerce/vendure/commit/8545267)), closes [#3217](https://github.com/vendure-ecommerce/vendure/issues/3217)
* **core** Fixed wrong join statement for variant on ProductVariantPrice (#3230) (#3231) ([7798ddc](https://github.com/vendure-ecommerce/vendure/commit/7798ddc)), closes [#3230](https://github.com/vendure-ecommerce/vendure/issues/3230) [#3231](https://github.com/vendure-ecommerce/vendure/issues/3231)
* **core** Improve resolution of OrderLine.featuredAsset (#3177) ([4530c81](https://github.com/vendure-ecommerce/vendure/commit/4530c81)), closes [#3177](https://github.com/vendure-ecommerce/vendure/issues/3177)
* **payments-plugin** False positive error logging fix in MolliePlugin (#3245) ([adfbda6](https://github.com/vendure-ecommerce/vendure/commit/adfbda6)), closes [#3245](https://github.com/vendure-ecommerce/vendure/issues/3245)

## <small>3.0.6 (2024-11-15)</small>

#### Fixes

* **admin-ui** Fix collection product filter dark theme (#3172) ([9f4eb9e](https://github.com/vendure-ecommerce/vendure/commit/9f4eb9e)), closes [#3172](https://github.com/vendure-ecommerce/vendure/issues/3172)
* **admin-ui** Fix incorrect type when dealing with numeric value in list (#3094) ([76d66c6](https://github.com/vendure-ecommerce/vendure/commit/76d66c6)), closes [#3094](https://github.com/vendure-ecommerce/vendure/issues/3094) [#3093](https://github.com/vendure-ecommerce/vendure/issues/3093)
* **admin-ui** Fix variant detail quick-jump component (#3189) ([478989e](https://github.com/vendure-ecommerce/vendure/commit/478989e)), closes [#3189](https://github.com/vendure-ecommerce/vendure/issues/3189)
* **admin-ui** Make registerPageTab work on 'order-list' location (#3187) ([61d808b](https://github.com/vendure-ecommerce/vendure/commit/61d808b)), closes [#3187](https://github.com/vendure-ecommerce/vendure/issues/3187)
* **admin-ui** Refund order dialog is showing the wrong field for prorated unit price (#3151) ([3777555](https://github.com/vendure-ecommerce/vendure/commit/3777555)), closes [#3151](https://github.com/vendure-ecommerce/vendure/issues/3151)
* **admin-ui** Swedish translation adjustments (#3174) ([a21f129](https://github.com/vendure-ecommerce/vendure/commit/a21f129)), closes [#3174](https://github.com/vendure-ecommerce/vendure/issues/3174)
* **common** Allow null on idsAreEqual function (#3171) ([7bba907](https://github.com/vendure-ecommerce/vendure/commit/7bba907)), closes [#3171](https://github.com/vendure-ecommerce/vendure/issues/3171)
* **core** Added deprecation notices to the old refund input fields (#3119) ([7324bb3](https://github.com/vendure-ecommerce/vendure/commit/7324bb3)), closes [#3119](https://github.com/vendure-ecommerce/vendure/issues/3119)
* **core** Disallow deletion of default channel (#3181) ([2ed3211](https://github.com/vendure-ecommerce/vendure/commit/2ed3211)), closes [#3181](https://github.com/vendure-ecommerce/vendure/issues/3181)
* **core** Fix error on internal Administrator customFields (#3159) ([e03b7f0](https://github.com/vendure-ecommerce/vendure/commit/e03b7f0)), closes [#3159](https://github.com/vendure-ecommerce/vendure/issues/3159)
* **core** Fix merging order with conflicting products using UseGuestStrategy (#3155) ([f0607aa](https://github.com/vendure-ecommerce/vendure/commit/f0607aa)), closes [#3155](https://github.com/vendure-ecommerce/vendure/issues/3155)
* **core** Fix returning stale data in Role Update Event (#3154) ([71f85d2](https://github.com/vendure-ecommerce/vendure/commit/71f85d2)), closes [#3154](https://github.com/vendure-ecommerce/vendure/issues/3154)
* **payments-plugin** Check for eligibility of Mollie method (#3200) ([a12dedc](https://github.com/vendure-ecommerce/vendure/commit/a12dedc)), closes [#3200](https://github.com/vendure-ecommerce/vendure/issues/3200)
* **payments-plugin** prevent false positive logging (#3195) ([961297d](https://github.com/vendure-ecommerce/vendure/commit/961297d)), closes [#3195](https://github.com/vendure-ecommerce/vendure/issues/3195)
* **testing** Make test client's `fileUploadMutation` work for more input variable shapes (#3188) ([a8938f4](https://github.com/vendure-ecommerce/vendure/commit/a8938f4)), closes [#3188](https://github.com/vendure-ecommerce/vendure/issues/3188)

## <small>3.0.5 (2024-10-15)</small>

#### Fixes

* **asset-server-plugin** Fix local file read vulnerability when using the LocalAssetStorageStrategy ([e2ee0c4](https://github.com/vendure-ecommerce/vendure/commit/e2ee0c43159b3d13b51b78654481094fdd4850c5)). See the [security advisory](https://github.com/vendure-ecommerce/vendure/security/advisories/GHSA-r9mq-3c9r-fmjq)
* **admin-ui** Fix theme & ui language switcher ([c93589b](https://github.com/vendure-ecommerce/vendure/commit/c93589b)), closes [#3111](https://github.com/vendure-ecommerce/vendure/issues/3111)
* **core** Do not include deleted variants when indexing productInStock (#3110) ([73cb190](https://github.com/vendure-ecommerce/vendure/commit/73cb190)), closes [#3110](https://github.com/vendure-ecommerce/vendure/issues/3110) [#3109](https://github.com/vendure-ecommerce/vendure/issues/3109)
* **core** Fix coupon code validation across multiple channels ([e57cc1b](https://github.com/vendure-ecommerce/vendure/commit/e57cc1b)), closes [#2052](https://github.com/vendure-ecommerce/vendure/issues/2052)
* **core** Fix filtering on list queries of tree entities ([227da05](https://github.com/vendure-ecommerce/vendure/commit/227da05)), closes [#3107](https://github.com/vendure-ecommerce/vendure/issues/3107)
* **core** Improve error message on populating without tax rates ([7e36131](https://github.com/vendure-ecommerce/vendure/commit/7e36131)), closes [#1926](https://github.com/vendure-ecommerce/vendure/issues/1926)

#### Features

* **create** Improved getting started experience (#3128) ([adb4384](https://github.com/vendure-ecommerce/vendure/commit/adb4384)), closes [#3128](https://github.com/vendure-ecommerce/vendure/issues/3128)

## <small>3.0.4 (2024-10-04)</small>

#### Fixes

* **admin-ui-plugin** Implement rate limiting on static server ([9516c71](https://github.com/vendure-ecommerce/vendure/commit/9516c71))
* **admin-ui** Add padding to default relation custom field dropdown ([02e68e0](https://github.com/vendure-ecommerce/vendure/commit/02e68e0))
* **admin-ui** Add support for custom fields on CustomerGroup list ([7128a33](https://github.com/vendure-ecommerce/vendure/commit/7128a33))
* **admin-ui** Enable selective loading of custom fields ([9d7744b](https://github.com/vendure-ecommerce/vendure/commit/9d7744b)), closes [#3097](https://github.com/vendure-ecommerce/vendure/issues/3097)
* **admin-ui** Fix bad locale detection regex ([f336d7f](https://github.com/vendure-ecommerce/vendure/commit/f336d7f))
* **admin-ui** Lazy-load only selected custom fields in list views ([690dd0f](https://github.com/vendure-ecommerce/vendure/commit/690dd0f)), closes [#3097](https://github.com/vendure-ecommerce/vendure/issues/3097)
* **admin-ui** Unsubscribe from alerts when logging out (#3071) ([f38340b](https://github.com/vendure-ecommerce/vendure/commit/f38340b)), closes [#3071](https://github.com/vendure-ecommerce/vendure/issues/3071) [#2188](https://github.com/vendure-ecommerce/vendure/issues/2188)
* **asset-server-plugin** Do not return raw error message on error ([801980e](https://github.com/vendure-ecommerce/vendure/commit/801980e))
* **core** Correctly parse numeric sessionDuration and verificationTokenDuration values (#3080) ([98e4118](https://github.com/vendure-ecommerce/vendure/commit/98e4118)), closes [#3080](https://github.com/vendure-ecommerce/vendure/issues/3080)
* **core** Fix issues caused by f235249f ([5a4299a](https://github.com/vendure-ecommerce/vendure/commit/5a4299a))
* **core** Fix RequestContext race condition causing null activeOrder ([f235249](https://github.com/vendure-ecommerce/vendure/commit/f235249)), closes [#2097](https://github.com/vendure-ecommerce/vendure/issues/2097)
* **core** Handle empty state for product and variant id filter (#3064) ([9a03c84](https://github.com/vendure-ecommerce/vendure/commit/9a03c84)), closes [#3064](https://github.com/vendure-ecommerce/vendure/issues/3064)
* **core** Prevent theoretical polynomial regex attack ([9f4a814](https://github.com/vendure-ecommerce/vendure/commit/9f4a814))
* **core** Remove duplicate call in applyCouponCode resolver ([bffc58a](https://github.com/vendure-ecommerce/vendure/commit/bffc58a))
* **core** Replace insecure randomness with secure randomBytes ([cb556d8](https://github.com/vendure-ecommerce/vendure/commit/cb556d8))
* **payments-plugin** Use default channel in Stripe webhook calls to reach all orders (#3076) ([8434111](https://github.com/vendure-ecommerce/vendure/commit/8434111)), closes [#3076](https://github.com/vendure-ecommerce/vendure/issues/3076)

#### Perf

* **core** Fix performance when using FacetValue-based checks ([a735bdf](https://github.com/vendure-ecommerce/vendure/commit/a735bdf))
* **admin-ui** List views only load the visible custom fields, closes [#3097](https://github.com/vendure-ecommerce/vendure/issues/3097)

## <small>3.0.3 (2024-09-11)</small>

#### Fixes

* **admin-ui** Display up to 3 decimal places in OrderSummary tax rate ([13a1b21](https://github.com/vendure-ecommerce/vendure/commit/13a1b21)), closes [#3051](https://github.com/vendure-ecommerce/vendure/issues/3051)
* **core** Fix regression in correctly setting OrderLine.featuredAsset ([7d070f2](https://github.com/vendure-ecommerce/vendure/commit/7d070f2))

## <small>3.0.2 (2024-09-10)</small>

#### Fixes

* **admin-ui** Fix removing coupon code from draft order ([04340f1](https://github.com/vendure-ecommerce/vendure/commit/04340f1)), closes [#2969](https://github.com/vendure-ecommerce/vendure/issues/2969)
* **core** Fix search indexing issue when working with multiple channels (#3041) ([75ed6e1](https://github.com/vendure-ecommerce/vendure/commit/75ed6e1)), closes [#3041](https://github.com/vendure-ecommerce/vendure/issues/3041) [#3012](https://github.com/vendure-ecommerce/vendure/issues/3012)
* **core** Prevent exposure of private custom fields via JSON type ([042abdb](https://github.com/vendure-ecommerce/vendure/commit/042abdb)), closes [#3049](https://github.com/vendure-ecommerce/vendure/issues/3049)
* **elasticsearch-plugin** Fix search multichannel indexing issue ([9d6f9cf](https://github.com/vendure-ecommerce/vendure/commit/9d6f9cf)), closes [#3012](https://github.com/vendure-ecommerce/vendure/issues/3012)

#### Perf

* **core** Fix slow `order` query for postgres v16 ([1baa8e7](https://github.com/vendure-ecommerce/vendure/commit/1baa8e7)), closes [#3037](https://github.com/vendure-ecommerce/vendure/issues/3037)
* **core** Omit ID encode/decode step if default EntityIdStrategy used ([ad30b55](https://github.com/vendure-ecommerce/vendure/commit/ad30b55))
* **core** Optimizations to the addItemToOrder path ([70ad853](https://github.com/vendure-ecommerce/vendure/commit/70ad853))
* **core** Optimize order operations ([e3d6c21](https://github.com/vendure-ecommerce/vendure/commit/e3d6c21))
* **core** Optimize resolution of featuredAsset fields ([d7bd446](https://github.com/vendure-ecommerce/vendure/commit/d7bd446))
* **core** Optimize setting active order on session ([c591432](https://github.com/vendure-ecommerce/vendure/commit/c591432))

## <small>3.0.1 (2024-08-21)</small>

#### Fixes

* **admin-ui** Add missing and revise portuguese and brazilian portuguese translations (#3002) ([9b5911f](https://github.com/vendure-ecommerce/vendure/commit/9b5911f)), closes [#3002](https://github.com/vendure-ecommerce/vendure/issues/3002)
* **admin-ui** Fix overflow in channel assignment block (#2984) ([0f8bdb5](https://github.com/vendure-ecommerce/vendure/commit/0f8bdb5)), closes [#2984](https://github.com/vendure-ecommerce/vendure/issues/2984)
* **admin-ui** Make sku optional in create-product-variant-dialog (#3007) ([13fe069](https://github.com/vendure-ecommerce/vendure/commit/13fe069)), closes [#3007](https://github.com/vendure-ecommerce/vendure/issues/3007) [#2999](https://github.com/vendure-ecommerce/vendure/issues/2999)
* **admin-ui** Use correct 24hr format for locale in dates (#2972) ([f078b41](https://github.com/vendure-ecommerce/vendure/commit/f078b41)), closes [#2972](https://github.com/vendure-ecommerce/vendure/issues/2972) [#2970](https://github.com/vendure-ecommerce/vendure/issues/2970)
* **core** Allow fulfillment creation with deleted product variants (#2982) ([752c2b6](https://github.com/vendure-ecommerce/vendure/commit/752c2b6)), closes [#2982](https://github.com/vendure-ecommerce/vendure/issues/2982) [#2434](https://github.com/vendure-ecommerce/vendure/issues/2434)
* **core** Fix EntityHydrator error on long table names (#2959) ([bcfcf7d](https://github.com/vendure-ecommerce/vendure/commit/bcfcf7d)), closes [#2959](https://github.com/vendure-ecommerce/vendure/issues/2959) [#2899](https://github.com/vendure-ecommerce/vendure/issues/2899)
* **core** Fix NaN error thrown when modifying pro-rated discounted OrderLine to 0 (#3009) ([fa50770](https://github.com/vendure-ecommerce/vendure/commit/fa50770)), closes [#3009](https://github.com/vendure-ecommerce/vendure/issues/3009)
* **core** Make firstName and lastName required in CreateCustomerAndUser method (#2996) ([0d8054d](https://github.com/vendure-ecommerce/vendure/commit/0d8054d)), closes [#2996](https://github.com/vendure-ecommerce/vendure/issues/2996)
* **core** Resolve User.roles field in GraphQL APIs (#3011) ([8f99b2d](https://github.com/vendure-ecommerce/vendure/commit/8f99b2d)), closes [#3011](https://github.com/vendure-ecommerce/vendure/issues/3011)
* **core** Return type of collection breadcrumb was missing slug (#2960) ([620eeb1](https://github.com/vendure-ecommerce/vendure/commit/620eeb1)), closes [#2960](https://github.com/vendure-ecommerce/vendure/issues/2960)
* **create** Dynamically find open port if 3000 in use ([a40fbb1](https://github.com/vendure-ecommerce/vendure/commit/a40fbb1))
* **create** Fix typo (#2994) ([999e89e](https://github.com/vendure-ecommerce/vendure/commit/999e89e)), closes [#2994](https://github.com/vendure-ecommerce/vendure/issues/2994)
* **create** Update EmailPlugin config to use templateLoader API ([6708440](https://github.com/vendure-ecommerce/vendure/commit/6708440)), closes [#2981](https://github.com/vendure-ecommerce/vendure/issues/2981)
* **payments-plugin** Fix Mollie not calling webhook on updated orders (#3014) ([694845f](https://github.com/vendure-ecommerce/vendure/commit/694845f)), closes [#3014](https://github.com/vendure-ecommerce/vendure/issues/3014) [#2941](https://github.com/vendure-ecommerce/vendure/issues/2941)
* **payments-plugin** Mollie - add missing request when settled amount is 0 (#2993) ([afd6435](https://github.com/vendure-ecommerce/vendure/commit/afd6435)), closes [#2993](https://github.com/vendure-ecommerce/vendure/issues/2993)

#### Perf

* **core** Improve hydrator performance for customFields (#2961) ([f40761d](https://github.com/vendure-ecommerce/vendure/commit/f40761d)), closes [#2961](https://github.com/vendure-ecommerce/vendure/issues/2961)
* **core** Refactor applyCollectionFiltersInternal method to improve performance (#2978) ([6eeae1c](https://github.com/vendure-ecommerce/vendure/commit/6eeae1c)), closes [#2978](https://github.com/vendure-ecommerce/vendure/issues/2978)

## 3.0.0 (2024-07-17)

Note: the changes in this release are identical to v2.3.0.

#### Features

* **admin-ui** Add support for tabs on custom UI routes ([26b4ea5](https://github.com/vendure-ecommerce/vendure/commit/26b4ea5))
* **admin-ui** Enable useQuery hook to refetch on channel change (#2869) ([3d516ea](https://github.com/vendure-ecommerce/vendure/commit/3d516ea)), closes [#2869](https://github.com/vendure-ecommerce/vendure/issues/2869)
* **core** Add RefundEvent & publish on Refund creation (#2832) ([cb08427](https://github.com/vendure-ecommerce/vendure/commit/cb08427)), closes [#2832](https://github.com/vendure-ecommerce/vendure/issues/2832) [#2830](https://github.com/vendure-ecommerce/vendure/issues/2830)
* **core** Enable inherit resolvers from interfaces (#2800) ([1069b3b](https://github.com/vendure-ecommerce/vendure/commit/1069b3b)), closes [#2800](https://github.com/vendure-ecommerce/vendure/issues/2800)
* **core** Make Refund process configurable (#2942) ([c8f1d62](https://github.com/vendure-ecommerce/vendure/commit/c8f1d62)), closes [#2942](https://github.com/vendure-ecommerce/vendure/issues/2942)
* **core** Publish event when OrderLine cancelled (#2829) ([213a26b](https://github.com/vendure-ecommerce/vendure/commit/213a26b)), closes [#2829](https://github.com/vendure-ecommerce/vendure/issues/2829)
* **create** Support SSL enforced PostgreSQL databases (#2905) ([65b4f3c](https://github.com/vendure-ecommerce/vendure/commit/65b4f3c)), closes [#2905](https://github.com/vendure-ecommerce/vendure/issues/2905)
* **email-plugin** Add support for computed email subject (#2863) ([e546f24](https://github.com/vendure-ecommerce/vendure/commit/e546f24)), closes [#2863](https://github.com/vendure-ecommerce/vendure/issues/2863)
* **email-plugin** Support dynamic globalTemplateVars (#2950) ([cab67b6](https://github.com/vendure-ecommerce/vendure/commit/cab67b6)), closes [#2950](https://github.com/vendure-ecommerce/vendure/issues/2950) [#2933](https://github.com/vendure-ecommerce/vendure/issues/2933)
* **ui-devkit** Support pnpm to build UI extensions (#2877) ([37e6a35](https://github.com/vendure-ecommerce/vendure/commit/37e6a35)), closes [#2877](https://github.com/vendure-ecommerce/vendure/issues/2877)

#### Fixes

* **core** Add usage check of nested custom property filters in ListQueryBuilder (#2939) ([05cfc9d](https://github.com/vendure-ecommerce/vendure/commit/05cfc9d)), closes [#2939](https://github.com/vendure-ecommerce/vendure/issues/2939)
* **core** Copy tax category on product duplication (#2947) ([2f0521c](https://github.com/vendure-ecommerce/vendure/commit/2f0521c)), closes [#2947](https://github.com/vendure-ecommerce/vendure/issues/2947)
* **core** Update DefaultSearchPlugin indexer controller to avoid TypeORM memory leak (#2883) ([ee2c177](https://github.com/vendure-ecommerce/vendure/commit/ee2c177)), closes [#2883](https://github.com/vendure-ecommerce/vendure/issues/2883)

#### Perf

* **core** Improve performance of role query with many channels ([fe3e455](https://github.com/vendure-ecommerce/vendure/commit/fe3e455)), closes [#2910](https://github.com/vendure-ecommerce/vendure/issues/2910)

**BREAKING CHANGE:** All core Vendure packages are now licensed under the GPL v3.0 license. See [LICENSE.md](./LICENSE.md) and the
[License FAQ](./license/license-faq.md).

## <small>2.x</small>

Changelogs for versions prior to v3.0.0 can be found in the [CHANGELOG_v2.md](./CHANGELOG_v2.md) and [CHANGELOG_v1.md](./CHANGELOG_v1.md) files.

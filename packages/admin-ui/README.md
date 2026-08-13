# Vendure Admin UI

This is the administration interface for Vendure.

It is an Angular application built with the Angular CLI.

The UI is powered by the [Clarity Design System](https://clarity.design).

## Structure

### Library

The Admin UI is structured as an Angular library conforming to the [ng-packagr format](https://github.com/ng-packagr/ng-packagr). This library is what is published to npm as `@vendure/admin-ui`. The library consists
of a set of modules which are accessible from consuming applications as sub-packages:

* `@vendure/admin-ui/core`
* `@vendure/admin-ui/catalog`
* `@vendure/admin-ui/orders`

etc. These library packages are located at [./src/lib](./src/lib)

When built with `bun run build`, the output will be located in the `./package` sub directory. This is also the root of the published npm package.

### Application

In addition to the library, there is also a full application located at [./src/app](./src/app). This application is used both during development of the Admin UI, and also as the "default" Admin UI without any UI extensions, as provided as the default by the [admin-ui-plugin](../admin-ui-plugin).

## Localization

Localization of UI strings is handled by [ngx-translate](https://ngx-translate.org). The translation strings should use the [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages).

Translation keys are automatically extracted by running:
```
bun run extract-translations
```
This scan the source files for any translation keys, and add them to each of the translation files located in [`./src/lib/static/i18n-messages/`](./src/lib/static/i18n-messages/).

A report is generated for each language detailing what percentage of the translation tokens are translated into that language:

```text
Extracting translation tokens for "src\lib\static\i18n-messages\de.json"
de: 592 of 650 tokens translated (91%)
```

This report data is also saved to the [i18n-coverage.json](./i18n-coverage.json) file.

To add support for a new language, create a new empty json file (`{}`) in the `i18n-messages` directory named `<languageCode>.json`, where `languageCode` is one of the supported codes as given in the [LanguageCode enum type](../core/src/api/schema/common/language-code.graphql), then run `bun run extract-translations`

To verify localization changes add `<languageCode>.json` to `./src/lib/static/vendure-ui-config.json` in the array `availableLanguages`. This will make the localization available in Admin UI development mode using `bun run dev`


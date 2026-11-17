# Core Translation Tooling

The server-side message catalogs live in `packages/core/src/i18n/messages/<lng>.json` and are loaded
by the `I18nService`. They hold four namespaces: `error`, `errorResult`, `message`, and
`configurableOperation`.

The script in this directory covers the `configurableOperation` namespace only. The other three are
maintained by hand.

## What lives in the `configurableOperation` namespace

The descriptions and argument labels of every promotion condition, promotion action, shipping
calculator, shipping eligibility checker, collection filter, payment handler, fulfillment handler
and entity duplicator shipped by core. These are the strings an administrator sees when configuring
a promotion or a shipping method.

English is not stored here. Each operation defines its English strings inline in its own `.ts` file,
and those are used whenever the catalog has no entry — so a missing translation falls back to
English rather than to a raw key.

The keys are derived from the operation itself:

```text
configurableOperation.<type>.<code>.description
configurableOperation.<type>.<code>.args.<argName>.label
configurableOperation.<type>.<code>.args.<argName>.description
configurableOperation.<type>.<code>.args.<argName>.options.<optionValue>.label
```

`<type>` is the registry the operation belongs to, such as `ShippingCalculator` or
`PromotionCondition`. It is part of the key because a code is only unique within its own registry:
`buy_x_get_y_free` is used by both a promotion condition and a promotion action.

You never need to write these keys by hand. Call `getTranslationKeys()` on any operation to see the
exact paths it expects, or let the script below generate them.

## Generating translations

The operations are read from the built package, so build core first:

```bash
npm run build
npm run i18n:extract
```

This writes `missing-translations.txt`, listing every English string which has no translation yet,
grouped by language. Paste that file into an LLM, save the reply as `translations.txt`, then:

```bash
npm run i18n:apply translations.txt
```

Apply refuses a batch whose strings do not look like they belong to the language they are labelled
with — a Croatian block containing Arabic script, or a Russian block with no Cyrillic in it, is
rejected outright rather than written to disk. The checks are shared with the dashboard tooling via
`packages/dashboard/scripts/translate/locale-profiles.js`, so the two cannot drift apart.

The set of supported languages comes from the dashboard's `.po` catalogs, which are the canonical
list for the project. A language file which does not exist yet in `src/i18n/messages/` is created on
first apply.

## Translation guidelines

1. **Reproduce placeholders exactly.** Several descriptions are templates rather than sentences, for
   example `Discount order by { discount }%`. The admin UI replaces `{ discount }` with the live
   argument value, matching on the exact name inside the braces, and it keeps the spaces. A renamed
   or reformatted placeholder is left in the text as-is and the administrator sees the raw braces.
2. **Keep technical terms untranslated.** "SKU", "API", "GraphQL", "JSON".
3. **Keep brand names untranslated.** "Vendure".
4. **Use formal address**, as is appropriate for business software.
5. **Assume e-commerce context.** "order" means a purchase, "customer" means a buyer, "variant"
   means a product variant.

## Overriding these strings from a plugin

The same catalog entries can be registered by a plugin, which is how you translate a third-party
operation without forking it, or override core's own wording:

```ts
this.i18nService.addTranslation('de', {
    configurableOperation: {
        ShippingCalculator: {
            'default-shipping-calculator': {
                description: 'Standard-Versandrechner',
                args: { rate: { label: 'Versandpreis' } },
            },
        },
    },
});
```

A catalog entry wins over the inline string for the same language. A key which matches no operation
is simply never read, so a typo produces no error — the inline English string is used instead. Use
`getTranslationKeys()` to check a key before assuming it is wrong somewhere else.

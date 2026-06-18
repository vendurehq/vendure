# Vendure Dashboard Translation Tooling

The script in this dir allow the efficient addition of new translations to the dashboard.

## Adding a New Language

1. Add the new language code to `packages/dashboard/lingui.config.js`
2. run `lingui extract`

This will create the new, empty .po file in `packages/dashboard/src/i18n/locales`

## Generating new translations

When you add new localized strings to the Dashboard app, you can generate translations
in each supported language like this:

1. run `npm run i18n:extract`
2. this will output a `missing-translations.txt` file in the dashboard dir
3. paste this into an LLM
4. save the output into `translations.txt` in the dashboard dir
5. run `npm run i18n:apply translations.txt`

## Translation Guidelines

### General Principles

1. **Preserve Technical Terms**: Keep terms like "API", "GraphQL", "JSON", "SKU" untranslated
2. **Maintain Placeholders**: Never modify placeholders like `{0}`, `{formattedDiff}`, `{entityName}`
3. **Use Formal Address**: Use formal addressing appropriate for business software
4. **Brand Names**: Keep "Vendure" and other brand names untranslated
5. **Context Awareness**: Consider the UI context when translating

### Critical Lingui-Specific Rules

1. **Explicit ID Translations**: For entries marked with "js-lingui-explicit-id" (e.g., `orderState.PartiallyDelivered`), translate ONLY the human-readable part, NOT the namespace:
   - ✅ `"orderState.PartiallyDelivered"` → `"Partiellement livré"` (French)
   - ❌ `"orderState.PartiallyDelivered"` → `"orderState.Partiellement livré"`

2. **E-commerce Domain Context**: Always assume e-commerce context unless clearly indicated otherwise:
   - `"order"` = e-commerce order (goods being purchased)
   - `"customer"` = e-commerce customer (buyer)
   - `"product"` = e-commerce product (item for sale)
   - `"variant"` = product variant (size, color, etc.)

## File Structure

```
packages/dashboard/src/i18n/locales/
├── en.po          # Source English file
├── de.po          # German translations
├── fr.po          # French translations (after creation)
└── ...            # Other language files
```

## Tips for Quality Translations

1. **Test in Context**: Always test translations in the actual UI
2. **Consistency**: Use consistent terminology across the application
3. **Length Considerations**: Some languages are more verbose - ensure UI still works
4. **Cultural Adaptation**: Consider cultural differences in business terminology
5. **Regular Updates**: Keep translations updated when English source changes

---
name: Radix to Base UI Migration
description: Migrates Vendure Dashboard extensions from Radix UI patterns to Base UI patterns (@vendure-io/ui).
---

# Radix to Base UI Migration

## Instructions

1. If not explicitly stated by the user, find out which files or plugin they want to migrate.
2. Scan the target files for any of the following Radix UI patterns:
   - `asChild` prop usage
   - Old form components (`FormField`, `FormItem`, `FormControl`, `FormLabel`, `FormMessage`, `FormDescription`)
   - Direct `@radix-ui/*` imports
   - Direct `@vendure-io/ui/*` or `@base-ui/react/*` imports
   - `Accordion` with `type="single"` or `collapsible` props
   - `Select` without `items` prop
3. Apply transformations using the appropriate reference docs:
   - ./01-asChild-to-render.md
   - ./02-form-components.md
   - ./03-import-consolidation.md
   - ./04-component-api-changes.md
4. After all transformations, verify:
   - All UI component imports come from `@vendure/dashboard`
   - No direct `@radix-ui/*`, `@vendure-io/ui/*`, or `@base-ui/react/*` imports remain
   - Only approved third-party imports are used (see 03-import-consolidation.md)

---
name: Migrating to Vendure Dashboard
description: Migrates Vendure Admin UI extensions (legacy Angular-based) to the new React Dashboard.
---

# Vendure Dashboard Migration

## Instructions

1. If not explicitly stated by the user, find out which plugin they want to migrate.
2. Read and understand the overall rules for migration
    - ./01-general.md
    - ./01a-common-tasks.md
3. Check the tsconfig setup <tsconfig-setup>. This may or may not already be set up.
    - ./01b-tsconfig-setup.md
4. Identify each part of the Admin UI extensions that needs to be
   migrated, and use the data from the appropriate sections to guide
   the migration:
    - ./02-forms.md
    - ./03-custom-field-inputs.md
    - ./04-list-pages.md
    - ./05-detail-pages.md
    - ./06-adding-nav-menu-items.md
    - ./07-action-bar-items.md
    - ./08-custom-detail-components.md
    - ./09-page-tabs.md
    - ./10-widgets.md
5. Ensure you have followed the instructions marked "Important" for each section

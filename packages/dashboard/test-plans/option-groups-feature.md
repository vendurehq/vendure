# Test Plan: Dashboard Option Groups Feature (#4478)

## Prerequisites
- Dev server running with `npm run populate` (fresh data recommended)
- Dashboard running at `http://localhost:5173/dashboard/`
- At least 2 channels configured (for channel assignment tests)
- Logged in as superadmin

---

## 1. Option Groups List Page

**Navigate to:** `/dashboard/option-groups`

**Expected:**
- Page title: "Option Groups"
- Data table with columns: Name, Code, Product Count, Created At, Updated At
- Each row shows a product option group (e.g. "screen-size", "laptop-ram")
- Product Count column shows integer values
- Name column entries are clickable links
- "New option group" button in action bar
- Bulk delete action available when rows are selected
- Search field filters by name
- Column visibility toggle works
- Pagination works if >10 items

---

## 2. Option Group Detail Page (standalone)

**Navigate to:** Click any option group name from the list, e.g. `/dashboard/option-groups/1`

**Expected:**
- Breadcrumbs: **Option Groups** > **[group name]**
- Main form with:
  - Translatable "Name" field
  - "Code" field (slug input, auto-generates from name for new entities)
- Custom fields block (if any configured)
- **Product Options** block (main column) — table listing individual options in this group, each clickable
  - "Add product option" button at the bottom
- **Products** block (sidebar) — lists actual product names that use this group, each clickable link to `/products/$id`
  - If no products assigned: "Not assigned to any products"
  - "Assign to products" button
- **Channels** block (sidebar, only visible if >1 channel) — shows assigned channels with remove chips
  - "Assign to channel" button
- **Shared option group warning** banner appears if productCount > 1: warns edits affect multiple products

**Actions to test:**
- Edit name → form becomes dirty → "Update" button enables → click → toast "Successfully updated option group"
- Edit code → same flow

---

## 3. Option Group Detail — Coming From Product

**Navigate to:** `/dashboard/products/[any-product-id]` → find the "Product Options" sidebar block → click the edit icon on an option group badge

**Expected URL:** `/dashboard/option-groups/[group-id]?from=product&productId=[product-id]`

**Expected breadcrumbs:** **Products** > **[Product Name]** > **Option Groups** > **[Group Name]**

**Everything else identical to test 2** — same form, same blocks, same functionality.

---

## 4. Create New Option Group

**Navigate to:** `/dashboard/option-groups` → click "New option group"

**Expected URL:** `/dashboard/option-groups/new`

**Expected:**
- Breadcrumbs: **Option Groups** > **New option group**
- Empty form with Name and Code fields
- No Product Options block (only shown for existing entities)
- No Products block (only shown for existing entities)
- "Create" button (disabled until form is valid)

**Actions:**
- Enter name "Test Group" → code auto-fills to "test-group"
- Click "Create" → toast "Successfully created option group" → redirects to `/dashboard/option-groups/[new-id]`

---

## 5. Product Options Table (within option group detail)

**Navigate to:** `/dashboard/option-groups/[id]` → scroll to "Product Options" block

**Expected:**
- Table of options with Name, Code columns
- Each option name is a clickable link
- "Add product option" button

**Click an option name:**
- **Expected URL:** `/dashboard/option-groups/[group-id]/options/[option-id]`
- **Breadcrumbs:** **Option Groups** > **[Group Name]** > **[Option Name]**
- Detail form with Name, Code, custom fields
- Sidebar shows "Option Group" info (name + code)

**Click "Add product option":**
- **Expected URL:** `/dashboard/option-groups/[group-id]/options/new`
- **Breadcrumbs:** **Option Groups** > **New option**
- Create form, same fields

---

## 6. Product Options — Coming From Product Context

**Navigate to:** `/dashboard/option-groups/[id]?from=product&productId=[pid]` → click an option name in the Product Options table

**Expected URL:** `/dashboard/option-groups/[group-id]/options/[option-id]?from=product&productId=[pid]`

**Expected breadcrumbs:** **Products** > **[Product Name]** > **Option Groups** > **[Group Name]** > **[Option Name]**

Same for "Add product option" — the `from` and `productId` query params should propagate.

---

## 7. Assign Option Group to Products (bulk)

**Navigate to:** `/dashboard/option-groups/[id]` → sidebar "Products" block → click "Assign to products"

**Expected:**
- Modal dialog: "Select Products"
- Search input to find products
- Product list with checkboxes, images, and names
- Selected items panel on right showing count + clear button
- Cancel / Select buttons at bottom

**Actions:**
- Search for a product → select 2-3 products → click "Select X Items"
- Toast: "Successfully assigned option group to X products"
- Products block updates to show the newly assigned product names as clickable links
- Product count in the shared warning banner updates accordingly

---

## 8. Channel Assignment (option group)

**Navigate to:** `/dashboard/option-groups/[id]` → sidebar "Channels" block (only if >1 channel configured)

**Expected:**
- Channel chips for each assigned channel (excluding default channel)
- Each chip has an X to remove (except active channel)
- "Assign to channel" button

**Assign to channel:**
- Click "Assign to channel" → dialog with channel dropdown → select channel → "Assign"
- Toast: "Successfully assigned 1 option group to channel"
- **Page refreshes** — new channel chip appears in the Channels block

**Remove from channel:**
- Click X on a non-active channel chip
- Toast: "Successfully removed option group from channel"
- **Page refreshes** — channel chip disappears

---

## 9. Channel Assignment (product detail — regression check)

**Navigate to:** `/dashboard/products/[id]` → sidebar "Channels" block

**Same flow as test 8 but for products.** Verify:
- Assign/remove works
- **Page refreshes** after assign/remove (this was broken before the `queryKeyScope` fix)

---

## 10. Shared Option Group Warning

**Navigate to:** `/dashboard/option-groups/[id]` where the group is assigned to 2+ products

**Expected:**
- Warning banner at top of page layout about shared option group affecting multiple products

**Navigate to an option group assigned to 0-1 products:**
- No warning banner

---

## 11. Delete Option Groups (from list)

**Navigate to:** `/dashboard/option-groups`

**Actions:**
- Select one or more option groups via checkboxes
- Bulk action "Delete" appears
- Click delete → confirmation dialog → confirm
- Toast success → rows removed from list

---

## 12. Deleted Routes No Longer Accessible

**Navigate directly to:**
- `/dashboard/products/1/option-groups/1` → should 404 or redirect (route no longer exists)
- `/dashboard/products/1/option-groups/1/options/1` → same

These product-scoped routes were removed in favour of the query parameter pattern.

---

## Quick Smoke Test Sequence (5 minutes)

1. Go to `/dashboard/option-groups` — list loads
2. Click first group — detail loads with products listed in sidebar
3. Back to products `/dashboard/products/[id]` — click option group badge — lands on `/dashboard/option-groups/[id]?from=product&productId=...` with product breadcrumbs
4. Click an option in the options table — breadcrumbs include product path
5. Back to option group detail — click "Assign to products" — select a product — confirm — product appears in sidebar list
6. If multi-channel: assign to channel — page refreshes with new channel chip — remove it — chip disappears

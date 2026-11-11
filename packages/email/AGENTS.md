# @vendure/email: guide for agents

How to change, add and verify the emails of a Vendure server that uses `@vendure/email`.

## Where things are

- `src/email/<type>/template.tsx`: what the email looks like. Subject, HTML body, optional plain text.
- `src/email/<type>/definition.ts`: when it is sent (event and filter), to whom, and the data the template gets.
- `src/email/index.ts`: the list of emails the server sends. `vendure-config.ts` passes it to `EmailPlugin.init({ emails })`.
- `vendure-config.ts`: `defaultFrom` and `globalTemplateVars`. `globalTemplateVars.branding` sets the shop name, logo, colours and footer text of every email.

If `src/email/<type>/` does not exist, the server uses the package default. Copy it into the project with `npx vendure email eject <type>`, then add the import to `src/email/index.ts`.

## The loop

Run these while the server and the worker are running. Every command prints JSON when its output is not a terminal.

1. Edit `template.tsx` or `definition.ts`. The server restarts on save.
2. `npx vendure email render <type> --preview`. It renders the email from real database data and prints `previewUrl`, which serves the rendered HTML without a login. Screenshot it with the browser 600px wide (desktop) and 375px wide (mobile). People use the Dashboard page System > Emails for the same preview.
3. Repeat until it looks right.
4. `npx vendure email check --language en,de` (use the shop's languages). It renders every email. Exit code 0 means no template threw.
5. Optional: `npx vendure email send <type> --to you@example.com` sends through the real job queue and worker, and waits until the email is in the dev outbox.

Exit codes: `0` success, `1` the email failed or nothing arrived in time, `2` the server is not reachable. On failure the JSON has a `stage`:

| Stage | Meaning | Where to look |
|---|---|---|
| `lookup` | Unknown email type | `src/email/index.ts` |
| `sample` | No database data for a preview | Create the data (place, ship or refund an order), or pass `--arg order=CODE` |
| `filter` | The definition's `filter` rejected the sample | `definition.ts`, or pick other data with `--arg` |
| `data` / `recipient` | That function in the definition threw | `definition.ts` |
| `render` | The template threw | `template.tsx` |
| `queue` | Not queued, or no worker processed it | Start the worker |
| `connect` | Server not running, or wrong `--url` | Start the server |

Sample data arguments: `--arg order=CODE` for order emails, `--arg target=<fulfillment, payment or refund id>` for emails about one of those, `--arg email=x@y.com` for account emails.

To check that a real action sends an email: run the action (e.g. a GraphQL mutation), then `npx vendure email outbox --since 2m --to <address> --wait 15`.

## Writing templates

- Use the components exported by `@vendure/email`: `EmailLayout` (always the root), `EmailSection` (`variant="muted"` for a grey box), `EmailTitle` (one per email, at the top), `EmailHeading` (small section label), `EmailText`, `EmailMutedText`, `EmailDivider`, `EmailButton` (`fallbackLink` also prints the URL), `Money`, `FormattedDate`, `OrderHighlights`, `OrderSummary`, `AddressBlock`, `FulfillmentSummary`. Pass `branding` from the props to `EmailLayout`.
- Reuse the colours, font and spacing in the exported `emailTheme` so a custom email matches the defaults. The brand colour (`branding.primaryColor`) is for buttons and links only.
- Use inline `style` props only. Email clients ignore `<style>` blocks, external CSS, class names, flexbox and grid. Lay out columns with `Row` and `Column` (exported by `@vendure/email`), or tables.
- Image URLs must be absolute. Order line images already are.
- Props have been through JSON: dates are ISO strings, money values are integers in minor units (use `<Money value={...} currencyCode={order.currencyCode} />`), and entity getters and methods are gone.
- Format money and dates with `Money` and `FormattedDate`. They use the email's language.
- To translate text, read the language with `useEmailContext().languageCode` and pick strings from a map.
- The subject is `subject: props => string`, or a string with `{{ path.to.value }}` placeholders.

## Changing when an email is sent or what data it gets

The scaffolded definition spreads the package default:

```ts
export const orderShippedEmail = defineEmail({
    ...packageDefault,
    template: OrderShippedTemplate,
});
```

Override one field and keep the rest. For example, add data for the template:

```ts
data: async input => ({
    ...(await packageDefault.data!(input)),
    loyaltyPoints: await input.injector.get(LoyaltyService).getPoints(input.ctx, input.event.order),
}),
```

Then add `loyaltyPoints` to the template's props interface.

## Adding an email

Create `src/email/<type>/definition.ts` with `defineEmail({ type, label, event, filter, data, recipient, template, sample })` and a `template.tsx` with `defineEmailTemplate()`. Add it to `src/email/index.ts`. Write a `sample` function so that `render`, `check` and the preview work. To let admins send it from the order detail page, add `orderSend: { targets, createEvent }`: `targets` lists what the email can be about and whether the current state allows sending it.

## Things not to do

- Don't configure `@vendure/email-plugin` as well. The server refuses to start, because every email would be sent twice.
- Don't remove the spread of the package default from a definition unless you mean to own all of its logic.
- Don't finish without running `vendure email check`.

# @vendure/email

Transactional emails for Vendure, with React templates. The default email package from Vendure v4. Replaces `@vendure/email-plugin`, which is deprecated.

- Emails are definitions (`defineEmail()`) with React templates (`defineEmailTemplate()`).
- Default emails: order confirmation, shipped, delivered, cancelled, refunded, payment failed, and the account emails.
- The order detail page of the Dashboard can preview and send order emails, when the order's state allows it.
- The Dashboard page System > Emails previews every email from real database data. In dev mode it also shows the outbox.
- The `vendure email` CLI renders, sends and checks emails, for agents and scripts. See [AGENTS.md](./AGENTS.md).

`npm install @vendure/email`

For documentation, see [docs.vendure.io/guides/core-concepts/email](https://docs.vendure.io/guides/core-concepts/email/).

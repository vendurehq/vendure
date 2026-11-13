# Email sending problems

Applies to: Vendure 3.x with `@vendure/email-plugin`. The admin password
reset email is a default handler since v3.8.0.

## Symptoms

- Order confirmation, verification or password reset emails do not arrive.
- No email is sent in development, or the dev mailbox is empty.
- SMTP errors in the log.
- Links in emails point to the wrong URL.
- A template error, or a template is not found.

## Checks

1. **Plugin present.** The context inventory lists `@vendure/email-plugin`,
   and the config `plugins` array has `EmailPlugin.init(...)`.
   Doc: `reference/core-plugins/email-plugin`
2. **Worker.** The EmailPlugin sends emails through the job queue (queue
   name `send-email`). When the worker does not run, or the job queue is
   in-memory with a separate worker, no email is sent. Do the worker checks in
   `startup.md`.
   Doc: `developer-guide/worker-job-queue#what-does-vendure-use-the-job-queue-for`
3. **Dev mode or transport.** With `devMode: true`, the plugin writes emails
   as HTML files to `outputPath` and does not send them. The dev mailbox is at
   the `route` path, for example `http://localhost:3000/mailbox`. Without dev
   mode, read the `transport.type`: `smtp`, `ses`, `sendmail`, `file`, `none`
   or `testing`. `none` and `testing` send nothing.
   Doc: `reference/core-plugins/email-plugin#dev-mode`,
   `reference/core-plugins/email-plugin/transport-options`
4. **Handlers.** Check that `handlers` includes `defaultEmailHandlers` or
   the custom handler for the event. A handler's `filter()` can skip an
   event. The order confirmation handler sends only on the transition to
   `PaymentSettled` and only when the order has a customer.
   Doc: `core-concepts/email#emaileventhandlers`
5. **Templates.** Check that the template path or `templateLoader` points to
   a directory that exists in the running app, also in the production build.
   When the plugin was installed by hand, the templates must be copied from
   `node_modules/@vendure/email-plugin/templates`.
   Doc: `reference/core-plugins/email-plugin#email-templates`
6. **Global template variables.** Links in emails come from
   `globalTemplateVars`, for example `verifyEmailAddressUrl` and
   `passwordResetUrl`. In v3.8.0 and later, the admin reset link needs
   `adminPasswordResetUrl`.
   Doc: `core-concepts/email#email-variables`
7. **SMTP.** Ask the user to set `logging: true` and `debug: true` on the
   SMTP transport and the logger level to `Debug`, then to send you the
   output with credentials removed.
   Doc: `reference/core-plugins/email-plugin#troubleshooting-smtp-connections`

## Remedies

| Cause                                 | Remedy                                                                      | Reference                                                              |
| ------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Worker not running or in-memory queue | Start the worker with a shared job queue strategy                           | `cases/startup.md`                                                     |
| Dev mode in the wrong environment     | Use `devMode` only in development; set a `transport` for other environments | `reference/core-plugins/email-plugin#dev-mode`                         |
| SMTP connection or auth errors        | Turn on SMTP `logging` and `debug`, then fix host, port or credentials      | `reference/core-plugins/email-plugin#troubleshooting-smtp-connections` |
| Handler missing or filtered           | Add the handler, or change its filter                                       | `reference/core-plugins/email-plugin/email-event-handler`              |
| Templates not found                   | Copy the templates and point the template loader at them                    | `reference/core-plugins/email-plugin#email-templates`                  |
| Wrong links in emails                 | Set the URL variables in `globalTemplateVars`                               | `core-concepts/email#email-variables`                                  |
| Different SMTP settings per channel   | Use a transport function                                                    | `reference/core-plugins/email-plugin#dynamic-smtp-settings`            |

All references are paths under `https://docs.vendure.io/current/core/`.

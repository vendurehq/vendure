# Self-hosted test app

The Publish & Install workflow installs this app from the packages it published to Verdaccio. It
then runs the server smoke tests and the Dashboard tests against it. `@vendure/create` writes a
Vendure Cloud app, which needs Docker and the Cloud runtime to start, so these tests use this
self-hosted app instead.

`__VENDURE_VERSION__` in `package.json` is replaced with the published version. `populate.ts`
seeds the same sample data that the Vendure repository's e2e tests use.

# Contribution Guidelines

Hi! Thank you for taking the time to contribute to Vendure!

In order to make the best use of both your time and that of the Vendure maintainers, please follow the guidelines in this document.

## Table of Contents

- [Getting Started](#getting-started)
- [Setting up the dev environment](#setting-up-the-dev-environment)
- [Development Workflow](#development-workflow)
- [Contribution Guidelines](#contribution-guidelines)
  - [Branches](#branches)
  - [Bug fixes](#bug-fixes)
  - [New features](#new-features)
  - [Commit message format](#commit-message-format)
- [Technical Standards](#advanced-topics)
  - [Code Generation](#code-generation)
  - [Testing](#testing)
  - [Release Process](#release-process)
- [Specific Contributions](#specific-contributions)
  - [Contributing to the documentation](#contributing-to-the-documentation)
  - [Contributing to the Admin UI translations](#contributing-to-the-admin-ui-translations)
- [Help & Support](#help--support)
  - [Where to get help](#where-to-get-help)
  - [Contributor License Agreement](#contributor-license-agreement)
  - [Issue Triage Guidelines](#issue-triage-guidelines)

## Getting Started

### Creating a fork

Start by creating a fork of the repository. This can be done by navigating to our [repository](https://github.com/vendurehq/vendure) and clicking on the fork button. This creates your own copy under your GitHub account. We recommend keeping "vendure" as the name of the fork.

### Cloning locally

Run the following commands to create a local clone of the repository files, where you can safely develop and test out your changes:

```bash
git clone https://github.com/YOUR-USERNAME/vendure.git
cd vendure
```

Add the [Vendure repository](https://github.com/vendurehq/vendure) as the upstream remote to your clone:

```bash
git remote add upstream https://github.com/vendurehq/vendure.git
```

This lets you pull updates from the original repository directly to your local clone.

### Staying up to date

> [!TIP]
> It is a good idea to regularly update your local and forked repositories. This keeps your development environment synchronised and minimizes potential merge conflicts when contributing.
>
> Here is [GitHub's official guide](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork) on keeping your forks synced.

There are **three main ways** to keep your fork synchronized:

#### Option 1: Using GitHub's Web Interface

Navigate to your fork's GitHub page and click the `Sync fork` button.

#### Option 2: Using GitHub CLI

GitHub offers a handy open-source CLI tool - [GitHub CLI](https://cli.github.com/) - which allows you to sync your branch directly in your terminal:

```bash
gh repo sync
```

#### Option 3: Using Git Commands

If you prefer using `git` commands, which can be more robust in some circumstances:

**First, fetch the latest changes:**
```bash
git fetch upstream
git checkout master
```

Now you're on the master branch of your local repository, and Git "knows" whether there are differences between your master branch and the upstream branch.

**Then, update your local and forked remote repositories:**
```bash
git merge upstream/master
git push origin master
```

## Setting up the dev environment

> [!IMPORTANT]
> The following instructions are for those who want to develop the Vendure core framework or plugins (e.g. if you intend to make a pull request). For instructions on how to build a project _using_ Vendure, please see the [Getting Started guide](https://docs.vendure.io/guides/getting-started/installation/).

### Prerequisites

- Node.js `^20.19.0 || >=22.12.0`
- [Bun](https://bun.sh/) — the canonical package manager for this repo. Install via `curl -fsSL https://bun.sh/install | bash` or one of the [other supported methods](https://bun.sh/docs/installation).

We use Bun (not npm) for installing dependencies because it provides two security features that defend against supply-chain attacks: a configurable minimum-release-age check on dependencies and an explicit `trustedDependencies` allow-list for packages whose lifecycle scripts we permit to run. See [#4674](https://github.com/vendurehq/vendure/issues/4674) for the rationale.

> [!WARNING]
> Always use `bun install` inside this repo. Running `npm install` will produce a `node_modules` that drifts from `bun.lock`, breaking CI parity. Vendure consumers (people installing `@vendure/core` and friends in their own projects) are unaffected — they can use whatever package manager they like.

### 1. Install top-level dependencies

`bun install`

The root directory has a `package.json` which contains build-related dependencies for tasks including:

- Building & deploying the docs
- Generating TypeScript types from the GraphQL schema
- Linting, formatting & testing tasks to run on git commit & push

### 2. Build all packages

`bun run build`

Packages must be built (i.e. TypeScript compiled, Admin UI app built, certain assets copied etc.) before being used.

Note that this can take a few minutes.

### 3. Start the docker containers

All the necessary infrastructure is defined in the root [docker-compose.yml](./docker-compose.yml) file. At a minimum,
you will need to start a database, for example:

```bash
docker-compose up -d mariadb
```

MariaDB/MySQL is the default that will be used by the dev server if you don't explicitly set the `DB` environment variable.

If for example you are doing development on the Elasticsearch plugin, you will also need to start the Elasticsearch container:

```bash
docker-compose up -d elasticsearch
```

### 4. Populate test data

Vendure uses [TypeORM](http://typeorm.io) and officially supports **MySQL**, **MariaDB**, **PostgreSQL**, and **SQLite**.

The first step is to populate the dev server with some test data:

```bash
cd packages/dev-server
bun run populate
```

By default, if you do not specify the `DB` environment variable, it will use **MySQL/MariaDB**.

If you want to develop against **PostgreSQL**:

1. Run the `postgres_16` Docker container.

```bash
docker-compose up -d postgres_16
```

2. Create a .env file in `/packages/dev-server` and declare the `DB` variable inside it:

    ```env
    DB=postgres
    ```
3. Now run the populate script.

> [!TIP]
> You can also set the environment variable directly in the CLI:
>
> ```bash
> DB=postgres bun run populate
> ```

### 5. Run the dev server

```bash
cd packages/dev-server
bun run dev
```

This will start the development server, and you should see output in your terminal indicating that the **Vendure development server** has successfully started.

The output lists the available endpoints for the Shop API, Admin API, GraphiQL interfaces, asset server, development mailbox, and the Admin UI, along with their respective URLs.

You can now access these services in your browser for development and testing.

Default Admin UI credentials:

Username: `superadmin`
Password: `superadmin`

## Development Workflow

### Testing Admin UI changes locally

If you are making changes to the Admin UI, you need to start the Admin UI independent from the dev-server:

> [!NOTE]
> You don't need this step when you just use the Admin UI just
> to test backend changes since the `dev-server` package ships with a default admin-ui

```
cd packages/admin-ui
bun run dev
```

This will run a separate process of admin-ui on "http://localhost:4200", you can login with the default credentials:

Username: `superadmin`
Password: `superadmin`

This will auto restart when you make changes to the Admin UI.

### Testing your changes locally

This example shows how to test changes to the `email-plugin` package locally.
This same workflow can be used for other packages as well.

### Terminal Setup

**In 2 separate terminal windows:**

**Terminal 1** - Watch changes to the package:

```bash
cd packages/email-plugin
bun run watch
```

**Terminal 2** - Run the development server:

```bash
cd packages/dev-server
bun run dev
```

> [!NOTE]
> After making changes, you need to stop and restart the development server to see your changes.

> [!WARNING]
> If you are developing changes for the `core` package, you also need to watch the `common` package:

in the root of the project:

```shell
bun run watch:core-common
```

#### Development Workflow Summary

1. Start your package watcher (bun run watch)
2. Start the dev-server (bun run dev)
3. Make code changes
4. Wait for compilation to complete
5. Restart dev-server to see changes

### Interactive debugging

To debug the dev server with VS Code use the included [launch.json](/.vscode/launch.json) configuration.

### Create a new branch

Before making changes, create a new branch for your work:

```bash
git checkout -b your-new-branch
```

### Developing and committing changes

After implementing your changes, stage the changes and commit them. Refer to the [Commit message format](#commit-message-format)

```
git add .
git commit -m "type(scope): Message in present tense"
```

### Creating a pull request

> [!TIP]
> Now would be a good time to [update](#staying-up-to-date) your local and remote repositories.

#### Prepare Your Branch

Make sure you have your new branch checked out and merge the latest changes from your up-to-date master branch:

```bash
git checkout your-new-branch
git merge master
```

#### Push Your Changes

Push your updated branch to your forked repository:

```bash
git push origin your-new-branch
```

#### Create Your Pull Request

**You can now create a pull request!** Choose one of the following methods:

**Option A: Using GitHub CLI**

If you have the [GitHub CLI](https://cli.github.com/) installed, run:
```bash
gh pr create
```
and follow the prompts - this will automatically use our [pull request template](https://github.com/vendurehq/vendure/blob/master/.github/pull_request_template.md).

**Option B: Using GitHub Web Interface**

Navigate to your forked repository on GitHub and create a pull request from there using the web interface.

**Well done!** Now comes our part: we will review your pull request and either merge it or provide you with feedback on what we would like to see changed.

## Contribution Guidelines

### Branches

There are 3 important branches to know about:

* `master` - the default branch
* `minor` - a branch for commits which introduce new features which would go in the next [SemVer minor](https://semver.org/) release.
* `major` - a branch for commits which introduce breaking changes which would go in the next [SemVer major](https://semver.org/) release.

Bug fixes should go directly to the `master` branch, from which new patch releases will be made regularly. Periodically, the master branch will be merged into the `minor` and `major` branches.

### Bug fixes

If you would like to contribute a bug fix, please first create an issue detailing the bug, and indicate that you intend to fix it. When creating commits, please follow the commit message format below.

### New features

Similarly, please create a feature request issue detailing the functionality you intend to add, and state that you would like to implement it. When creating commits, please follow the commit message format below. Submit new feature pull requests to the `minor` branch.

When adding new public APIs to support your new feature, add a `@since 1.2.0` tag (where "1.2.0" corresponds to what will be the next minor version) to the doc block. This will let readers of the documentation know the version in which the API was introduced. See the [docs readme](./docs/README.md) for more details on the valid docs tags.

```TypeScript
/**
 * @description
 * Sets the value of the new API thing.
 *
 * @since 1.2.0
 */
myNewApi: number;
```

### Commit message format

This repo uses [Conventional Commits](https://www.conventionalcommits.org).

```
type(scope): Message in present tense
```
`type` may be one of:
* **feat** (new feature)
* **fix** (bug fix)
* **docs** (changes to documentation)
* **perf** (performance improvements)
* **style** (formatting, missing semi colons, etc; no code change)
* **refactor** (refactoring production code)
* **test** (adding missing tests, refactoring tests; no production code change)
* **chore** (updating build tasks etc; no production code change)

`scope` indicates the package affected by the commit:

* admin-ui
* admin-ui-plugin
* asset-server-plugin
* common
* core
* create
* email-plugin
* etc.

If a commit affects more than one package, separate them with a comma:

```
fix(core,common): Fix the thing
```

If a commit applies to no particular package (e.g. a tooling change in the root package.json), the scope can be omitted.

#### Breaking Changes

If your contribution includes any breaking changes (including any changes to the DB schema; backwards-incompatible changes to the GraphQL APIs or VendureConfig; backwards-incompatible changes to current behavior), please include a `BREAKING CHANGE` section in your commit message as per the [Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/#commit-message-with-both-and-breaking-change-footer).

Please also make your pull request against the `major` branch rather than `master` in the case of breaking changes.

Example:

```
feat(core): Add new field to Customer

Relates to #123. This commit adds the "foo" field to the Custom entity.

BREAKING CHANGE: A DB migration will be required in order to add the new "foo" field to the customer table.
```

#### Linting

Commit messages are linted on commit, so you'll know if your message is not quite right.

## Advanced Topics

### Code Generation

[graphql-code-generator](https://github.com/dotansimha/graphql-code-generator) is used to automatically create TypeScript interfaces for all GraphQL server operations and Admin UI queries. These generated interfaces are used in both the Admin UI and the server.

Running `bun run codegen` will generate the following files:

- [`packages/common/src/generated-types.ts`](./packages/common/src/generated-types.ts): Types, Inputs & resolver args relating to the Admin API
- [`packages/common/src/generated-shop-types.ts`](./packages/common/src/generated-shop-types.ts): Types, Inputs & resolver args relating to the Shop API
- [`packages/admin-ui/src/lib/core/src/common/generated-types.ts`](./packages/admin-ui/src/lib/core/src/common/generated-types.ts): Types & operations relating to the admin-ui queries & mutations.
- [`packages/admin-ui/src/lib/core/src/common/introspection-result.ts`](./packages/admin-ui/src/lib/core/src/common/introspection-result.ts): Used by the Apollo Client [`IntrospectionFragmentMatcher`](https://www.apollographql.com/docs/react/data/fragments/#fragments-on-unions-and-interfaces) to correctly handle fragments in the Admin UI.
- Also generates types used in e2e tests in those packages which feature e2e tests (core, asset-server-plugin etc).

### Testing

#### Server Unit Tests

The core and several other packages have unit tests which can be run all together by running `bun run test` from the root directory, or individually by running it from the package directory.

Unit tests are co-located with the files which they test, and have the suffix `.spec.ts`.

If you're getting `Error: Bindings not found.`, please run `bun install --force`.

#### End-to-end Tests

Certain packages have e2e tests, which are located at `/packages/<n>/e2e/`. All e2e tests can be run by running `bun run e2e` from the root directory, or individually by running it from the package directory.

e2e tests use the `@vendure/testing` package. For details of how the setup works, see the [Testing docs](https://docs.vendure.io/guides/developer-guide/testing/).

When **debugging e2e tests**, set an environment variable `E2E_DEBUG=true` which will increase the global Jest timeout and allow you to step through the e2e tests without the tests automatically failing due to timeout.

### Release Process

All packages in this repo are released at every version change (using [Lerna's fixed mode](https://lerna.js.org/docs/features/version-and-publish#fixedlocked-mode-default)). This simplifies both the development (tracking multiple disparate versions is tough) and also the developer experience for users of the framework (it is simple to see that all packages are up-to-date and compatible).

To make a release:

#### 1. `bun run publish-release`

It will run `lerna version` which will prompt for which version to update to. Although we are using [conventional commits](https://www.conventionalcommits.org), the version is not automatically being calculated from the commit messages. Therefore, the next version should be manually selected.

Next it will build all packages to ensure the distributed files are up to date.

Finally, the command will create changelog entries for this release and create a tagged commit.

#### 2. `git push origin master --follow-tags`

Push the version commit and the new tag to `master`. (Lerna is run with `--no-push` so that pushing is a deliberate, separate step — the repo has a lengthy pre-push hook that runs the full test suite and builds the Admin UI.)

Publishing itself happens in CI, not locally: it is triggered by creating the GitHub release in the next step, using OIDC trusted publishing (no npm token or local OTP is involved).

#### 3. Create a GitHub release

Create a GitHub release based on the tag generated by Lerna. This triggers the "Publish to NPM" workflow, which builds and **stages** each package via `npm stage publish`. Packages are signed with provenance attestations, which [trusted publishing generates automatically](https://docs.npmjs.com/trusted-publishers/).

> [!IMPORTANT]
> Staged packages are **not yet live** on npm. They sit in npm's [staging area](https://www.npmjs.com/settings/~/staged-packages) awaiting manual approval. This is a deliberate supply-chain safeguard: a release only goes public after a maintainer approves it with 2FA, so a compromised CI run cannot publish to the `latest` tag on its own. See [#4772](https://github.com/vendurehq/vendure/issues/4772) for the rationale.

#### 4. Approve the staged packages

Once the workflow has finished staging every package, approve them so they go live on the registry:

```bash
./scripts/npm-stage-approve-all.sh <version>   # e.g. 3.7.0
```

This finds every staged `@vendure/*` package at the given version and approves them all behind a single 2FA prompt — the first approval triggers the one-time password, and the rest ride npm's ~5-minute OTP skip window. **Until this step completes, the new versions are not installable.**

Requirements: npm `>= 11.15.0` and an authenticated npm session (check with `npm whoami`).

> [!WARNING]
> If a staged package is wrong, reject it with `npm stage reject <id>`. This is **permanent** — the version slot is consumed and cannot be reused, so you must bump to the next patch version rather than re-staging the same one.

Note that releases are therefore no longer fire-and-forget: coordinate any announcements to happen _after_ the approval step, since the packages are not installable until then.

## Specific Contributions

### Contributing to the documentation

For our [documentation](https://docs.vendure.io/), we use [Docusaurus](https://docusaurus.io/).

After [setting up your development environment](#setting-up-the-dev-environment), navigate to the docs directory and start the docusaurus server:
```bash
cd docs
bun run start
```

this will output a URL where you can preview your changes.

You can find all of our documentation built by docusaurus in these directories: 

```
docs/docs
├── guides
├── reference // only contains generated documentation
└── user-guide
```

> [!NOTE]
> Files in the [reference](https://docs.vendure.io/reference/) directory are auto-generated. To edit reference documentation, modify the [JSDoc](https://jsdoc.app/about-getting-started) comments in the source code and run `bun run docs:build` from the project root directory.

### Contributing to the Admin UI translations

If you wish to contribute translations of the Admin UI into another language (or improve an existing set of translations), please see the [Localization guide](https://github.com/vendurehq/vendure/blob/master/packages/admin-ui/README.md#localization) in the admin-ui package.

## Help & Support

### Where to get help

We have an active discord community, join us there and ask away!
[Vendure Discord](https://www.vendure.io/community) 

Read the documentation - Our comprehensive [documentation](https://docs.vendure.io/) covers everything you need to know about Vendure. It also includes guides and references for the tools that we use.

In case your pull request doesn't meet our requirements, we're here to help! We'll provide thorough reviews with clear guidance on how to get your contribution merged.

### Contributor License Agreement

All contributors are required to agree to the [Contributor License Agreement](./license/CLA.md) before their contributions can be merged.

This is done via an automation bot which will prompt you to sign the CLA when you open a pull request.

### Issue Triage Guidelines

This section is meant for maintainers to help triage issues.

#### Quality Control

- [ ] Does the issue have a **clear title and description**?
- [ ] Was the **issue template followed** and is all required info available?
- [ ] If it's a **bug report**, are there **clear steps to reproduce**?

If any of the above are missing:
- Add a relevant **blue label** (e.g., `needs reproduction`, `missing info`)
- Comment to ask the reporter to supply the missing information

#### Check for Duplicates

Search to see if the issue is already reported or resolved. If it is a duplicate, close the issue with a message like `Duplicate of #123`.

#### Label the Issue
- [ ] Set an **Issue Type**: `bug`, `feature` or `task`
- [ ] **Package**: label with relevant package/component
- [ ] Assign a **Priority Label** if possible

#### Stale Issues

Issues that need more information should be closed after 1 month of inactivity.

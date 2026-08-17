# Vendure Create

A CLI tool for rapidly scaffolding a new Vendure server application. Heavily inspired by [create-react-app](https://github.com/facebook/create-react-app).

## Usage

Vendure Create requires [Node.js](https://nodejs.org/en/) v18+ to be installed.

```sh
npx @vendure/create my-app
```

## Options

### `--storefront`

In CI mode, include one of the available storefront starters. Currently supported values are `tanstack` and `nextjs`.

```sh
npx @vendure/create my-app --ci --storefront tanstack
```

The legacy `--with-storefront` flag continues to select the Next.js starter.

### `--log-level`

You can control how much output is generated during the installation and setup with this flag. Valid options are `silent`, `info` and `verbose`. The default is `info`

Example:

```sh
npx @vendure/create my-app --log-level verbose
```

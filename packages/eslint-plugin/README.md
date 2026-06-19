# @vendure/eslint-plugin

Vendure-specific ESLint rules for catching common mistakes in Vendure projects and custom plugins.

## Usage

```js
import vendure from '@vendure/eslint-plugin';

export default [
    ...vendure.configs.recommended,
];
```

The recommended config is intended for generated Vendure projects and custom plugin code.

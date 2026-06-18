---
paths:
  - "packages/dashboard/**/*.tsx"
  - "packages/dashboard/**/*.ts"
---

# Dashboard Development

## i18n / Translations

**All user-facing strings MUST be wrapped for translation.** Never hard-code English strings.

```tsx
import { Trans, useLingui } from '@lingui/react/macro';

// JSX content
<Trans>Your text here</Trans>

// Dynamic strings (variables, props, toasts)
const { t } = useLingui();
toast.success(t`Operation completed`);
```

**When adding default config values** (dropdown options, reason lists, status labels):
- Use `t\`...\`` at render time
- Never hardcode English strings that display to users

Translation files: `packages/dashboard/src/i18n/locales/*.po`

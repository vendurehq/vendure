import type { Provider } from '@nestjs/common';

import { adminToolProviders } from './admin';
import { shopToolProviders } from './shop';

export const mcpBuiltInToolProviders: Provider[] = [...shopToolProviders, ...adminToolProviders];

// Resolved through `paths`, and through `baseUrl` alone, both of which TypeScript 7 rejects.
import { greet } from '@shared/greeting';
import { greet as greetViaBaseUrl } from 'shared/greeting';

function Injectable(): ClassDecorator {
    return () => undefined;
}

@Injectable()
export class GreetingService {
    hello(name: string): string {
        return greet(name) === greetViaBaseUrl(name) ? greet(name) : 'mismatch';
    }
}

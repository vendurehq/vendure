import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../../config/config.service';

/**
 * @description
 * Used in the {@link NativeAuthenticationStrategy} when hashing and checking user passwords.
 */
@Injectable()
export class PasswordCipher {
    constructor(private configService: ConfigService) {}
    hash(plaintext: string): Promise<string> {
        return this.configService.authOptions.passwordHashingStrategy.hash(plaintext);
    }

    check(plaintext: string, hash: string): Promise<boolean> {
        return this.configService.authOptions.passwordHashingStrategy.check(plaintext, hash);
    }
}

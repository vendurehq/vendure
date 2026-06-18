import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { getAppConfig } from '../../app.config';
import { AuthService } from '../auth/auth.service';

/**
 * This guard prevents unauthorized users from accessing any routes which require
 * authorization.
 */
@Injectable({
    providedIn: 'root',
})
export class AuthGuard  {
    private readonly externalLoginUrl: string | undefined;

    constructor(private router: Router, private authService: AuthService) {
        this.externalLoginUrl = getAppConfig().loginUrl;
    }

    canActivate(route: ActivatedRouteSnapshot): Observable<boolean> {
        return this.authService.checkAuthenticatedStatus().pipe(
            tap(authenticated => {
                if (!authenticated) {
                    if (this.externalLoginUrl) {
                        window.location.href = this.externalLoginUrl;
                    } else {
                        this.router.navigate(['/login']);
                    }
                }
            }),
        );
    }
}

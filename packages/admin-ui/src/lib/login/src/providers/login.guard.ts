import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '@vendure/admin-ui/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * This guard prevents loggen-in users from navigating to the login screen.
 */
@Injectable({
    providedIn: 'root',
})
export class LoginGuard  {
    constructor(private router: Router, private authService: AuthService) {}

    canActivate(route: ActivatedRouteSnapshot): Observable<boolean> {
        return this.authService.checkAuthenticatedStatus().pipe(
            map(authenticated => {
                if (authenticated) {
                    this.router.navigate(['/']);
                }
                return !authenticated;
            }),
        );
    }
}

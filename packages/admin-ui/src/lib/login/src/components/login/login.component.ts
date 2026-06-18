import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
    ADMIN_UI_VERSION,
    AuthService,
    AUTH_REDIRECT_PARAM,
    getAppConfig,
    LocalizationDirectionType,
    LocalizationService,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss'],
    standalone: false,
})
export class LoginComponent implements OnInit {
    direction$: LocalizationDirectionType;

    username = '';
    password = '';
    rememberMe = false;
    version = ADMIN_UI_VERSION;
    errorMessage: string | undefined;
    brand = getAppConfig().brand;
    hideVendureBranding = getAppConfig().hideVendureBranding;
    customImageUrl = getAppConfig().loginImageUrl;
    imageUrl = '';
    imageUnsplashUrl = '';
    imageLocation = '';
    imageCreator = '';
    imageCreatorUrl = '';

    constructor(
        private authService: AuthService,
        private router: Router,
        private httpClient: HttpClient,
        private localizationService: LocalizationService,
    ) {
        if (this.customImageUrl) {
            this.imageUrl = this.customImageUrl;
        } else {
            this.loadImage();
        }
    }
    ngOnInit(): void {
        this.direction$ = this.localizationService.direction$;
    }

    logIn(): void {
        this.errorMessage = undefined;
        this.authService.logIn(this.username, this.password, this.rememberMe).subscribe(result => {
            switch (result.__typename) {
                case 'CurrentUser':
                    const redirect = this.getRedirectRoute();
                    this.router.navigateByUrl(redirect ? redirect : '/');
                    break;
                case 'InvalidCredentialsError':
                case 'NativeAuthStrategyError':
                    this.errorMessage = result.message;
                    break;
            }
        });
    }

    loadImage() {
        this.httpClient
            .get('https://login-image.vendure.io')
            .toPromise()
            .then(res => {
                this.updateImage(res);
            });
    }

    updateImage(res: any) {
        const user: any = (res as any).user;
        const location: any = (res as any).location;

        this.imageUrl = res.urls.regular + '?utm_source=Vendure+Login+Image&utm_medium=referral';
        this.imageCreator = user.name;
        this.imageLocation = location.name;
        this.imageCreatorUrl = user.links.html + '?utm_source=Vendure+Login+Image&utm_medium=referral';
        this.imageUnsplashUrl = res.links.html;
    }

    /**
     * Attempts to read a redirect param from the current url and parse it into a
     * route from which the user was redirected after a 401 error.
     */
    private getRedirectRoute(): string | undefined {
        let redirectTo: string | undefined;
        const re = new RegExp(`${AUTH_REDIRECT_PARAM}=(.*)`);
        try {
            const redirectToParam = window.location.search.match(re);
            if (redirectToParam && 1 < redirectToParam.length) {
                redirectTo = atob(decodeURIComponent(redirectToParam[1]));
            }
        } catch (e: any) {
            // ignore
        }
        return redirectTo;
    }
}

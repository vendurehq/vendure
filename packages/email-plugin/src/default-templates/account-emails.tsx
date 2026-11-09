import { EmailButton, EmailLayout, EmailSection, EmailText } from '../components/blocks';
import { EmailBranding } from '../components/branding';
import { urlWithToken } from '../components/formatting';
import { defineEmailTemplate } from '../template/email-template';

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export interface EmailVerificationEmailProps {
    /**
     * @description
     * Global template variable: the storefront page which verifies the token.
     */
    verifyEmailAddressUrl: string;
    verificationToken: string;
    branding?: EmailBranding;
}

/**
 * @description
 * The default template of the `email-verification` email, used by the {@link emailVerificationHandler}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export const EmailVerificationEmail = defineEmailTemplate<EmailVerificationEmailProps>(
    ({ verifyEmailAddressUrl, verificationToken, branding }) => (
        <EmailLayout
            title="Verify Your Email Address"
            preview="Verify your email address"
            branding={branding}
        >
            <EmailSection>
                <EmailText>
                    Thank you for creating an account. Click the button below to verify this email address and
                    complete the registration process:
                </EmailText>
                <EmailButton href={urlWithToken(verifyEmailAddressUrl, verificationToken)}>
                    Verify Me!
                </EmailButton>
            </EmailSection>
        </EmailLayout>
    ),
);

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export interface PasswordResetEmailProps {
    /**
     * @description
     * Global template variable: the storefront page which resets the password.
     */
    passwordResetUrl: string;
    passwordResetToken: string;
    branding?: EmailBranding;
}

/**
 * @description
 * The default template of the `password-reset` email, used by the {@link passwordResetHandler}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export const PasswordResetEmail = defineEmailTemplate<PasswordResetEmailProps>(
    ({ passwordResetUrl, passwordResetToken, branding }) => (
        <PasswordResetLayout
            intro="Someone requested a new password for your account."
            href={urlWithToken(passwordResetUrl, passwordResetToken)}
            branding={branding}
        />
    ),
);

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export interface AdminPasswordResetEmailProps {
    /**
     * @description
     * Global template variable: the Dashboard page which resets the password.
     */
    adminPasswordResetUrl: string;
    passwordResetToken: string;
    branding?: EmailBranding;
}

/**
 * @description
 * The default template of the `admin-password-reset` email, used by the {@link adminPasswordResetHandler}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export const AdminPasswordResetEmail = defineEmailTemplate<AdminPasswordResetEmailProps>(
    ({ adminPasswordResetUrl, passwordResetToken, branding }) => (
        <PasswordResetLayout
            intro="Someone requested a new password for your administrator account."
            href={urlWithToken(adminPasswordResetUrl, passwordResetToken)}
            branding={branding}
        />
    ),
);

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export interface EmailAddressChangeEmailProps {
    /**
     * @description
     * Global template variable: the storefront page which verifies the new address.
     */
    changeEmailAddressUrl: string;
    identifierChangeToken: string;
    branding?: EmailBranding;
}

/**
 * @description
 * The default template of the `email-address-change` email, used by the {@link emailAddressChangeHandler}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export const EmailAddressChangeEmail = defineEmailTemplate<EmailAddressChangeEmailProps>(
    ({ changeEmailAddressUrl, identifierChangeToken, branding }) => (
        <EmailLayout
            title="Verify Your New Email Address"
            preview="Verify your new email address"
            branding={branding}
        >
            <EmailSection>
                <EmailText>
                    We received a request to change your registered email address to this one. Click the
                    button below to verify this address and complete the process:
                </EmailText>
                <EmailButton href={urlWithToken(changeEmailAddressUrl, identifierChangeToken)}>
                    Verify Me!
                </EmailButton>
            </EmailSection>
        </EmailLayout>
    ),
);

function PasswordResetLayout({
    intro,
    href,
    branding,
}: {
    intro: string;
    href: string;
    branding?: EmailBranding;
}) {
    return (
        <EmailLayout title="Forgotten password reset" preview="Reset your password" branding={branding}>
            <EmailSection>
                <EmailText>{intro}</EmailText>
                <EmailButton href={href}>Reset password</EmailButton>
                <EmailText>
                    If you didn&apos;t make this request then you can safely ignore this email - nothing has
                    been changed on your account.
                </EmailText>
            </EmailSection>
        </EmailLayout>
    );
}

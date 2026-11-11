import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { defineEmailTemplate } from '../../template/email-template';

export interface PasswordResetProps {
    /** Global template variable: the storefront password reset page. */
    passwordResetUrl?: string;
    passwordResetToken: string;
    branding?: EmailBranding;
}

export const PasswordResetTemplate = defineEmailTemplate<PasswordResetProps>({
    subject: 'Reset your password',
    body: ({ passwordResetUrl, passwordResetToken, branding }) => (
        <EmailLayout title="Reset your password" preview="Choose a new password for your account" branding={branding}>
            <EmailSection>
                <EmailTitle>Reset your password</EmailTitle>
                <EmailText>We received a request to reset the password of your account. Choose a new one below.</EmailText>
                <EmailButton href={urlWithToken(passwordResetUrl, passwordResetToken)} fallbackLink>
                    Choose a new password
                </EmailButton>
                <EmailMutedText>
                    If you did not ask for this, you can ignore this email. Your password has not been changed.
                </EmailMutedText>
            </EmailSection>
        </EmailLayout>
    ),
});

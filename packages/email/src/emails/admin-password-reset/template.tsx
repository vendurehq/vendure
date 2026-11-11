import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { defineEmailTemplate } from '../../template/email-template';

export interface AdminPasswordResetProps {
    /** Global template variable: the Dashboard password reset page. */
    adminPasswordResetUrl?: string;
    passwordResetToken: string;
    branding?: EmailBranding;
}

export const AdminPasswordResetTemplate = defineEmailTemplate<AdminPasswordResetProps>({
    subject: 'Reset your Dashboard password',
    body: ({ adminPasswordResetUrl, passwordResetToken, branding }) => (
        <EmailLayout title="Reset your password" preview="Choose a new password for your administrator account" branding={branding}>
            <EmailSection>
                <EmailTitle>Reset your password</EmailTitle>
                <EmailText>
                    We received a request to reset the password of your administrator account. Choose a new one below.
                </EmailText>
                <EmailButton href={urlWithToken(adminPasswordResetUrl, passwordResetToken)} fallbackLink>
                    Choose a new password
                </EmailButton>
                <EmailMutedText>
                    If you did not ask for this, you can ignore this email. Your password has not been changed.
                </EmailMutedText>
            </EmailSection>
        </EmailLayout>
    ),
});

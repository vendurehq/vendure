import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { defineEmailTemplate } from '../../template/email-template';

export interface EmailVerificationProps {
    /** Global template variable: the storefront page that verifies the address. */
    verifyEmailAddressUrl?: string;
    verificationToken: string;
    branding?: EmailBranding;
}

export const EmailVerificationTemplate = defineEmailTemplate<EmailVerificationProps>({
    subject: 'Please verify your email address',
    body: ({ verifyEmailAddressUrl, verificationToken, branding }) => (
        <EmailLayout title="Verify your email address" preview="Confirm your email address to finish signing up" branding={branding}>
            <EmailSection>
                <EmailTitle>Verify your email address</EmailTitle>
                <EmailText>Thanks for creating an account. Confirm this email address to finish signing up.</EmailText>
                <EmailButton href={urlWithToken(verifyEmailAddressUrl, verificationToken)} fallbackLink>
                    Verify email address
                </EmailButton>
                <EmailMutedText>If you did not create an account, you can ignore this email.</EmailMutedText>
            </EmailSection>
        </EmailLayout>
    ),
});

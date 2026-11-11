import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { defineEmailTemplate } from '../../template/email-template';

export interface EmailAddressChangeProps {
    /** Global template variable: the storefront page that confirms the new address. */
    changeEmailAddressUrl?: string;
    identifierChangeToken: string;
    branding?: EmailBranding;
}

export const EmailAddressChangeTemplate = defineEmailTemplate<EmailAddressChangeProps>({
    subject: 'Confirm your new email address',
    body: ({ changeEmailAddressUrl, identifierChangeToken, branding }) => (
        <EmailLayout title="Confirm your new email address" preview="Confirm the change of your email address" branding={branding}>
            <EmailSection>
                <EmailTitle>Confirm your new email address</EmailTitle>
                <EmailText>
                    We received a request to change the email address of your account to this one. Confirm it to
                    finish the change.
                </EmailText>
                <EmailButton href={urlWithToken(changeEmailAddressUrl, identifierChangeToken)} fallbackLink>
                    Confirm email address
                </EmailButton>
                <EmailMutedText>If you did not ask for this, you can ignore this email.</EmailMutedText>
            </EmailSection>
        </EmailLayout>
    ),
});

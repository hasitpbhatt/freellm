// Transactional email using Resend (simple API key, no domain verification needed for testing).
// Set RESEND_API_KEY secret in production.
// Development fallback: logs the link and returns it in the API response.

import type { Bindings } from './types'

export type SendResult = { sent: boolean; devLink?: string }

export async function sendVerificationEmail(env: Bindings, to: string, link: string): Promise<SendResult> {
  if (env.ENVIRONMENT === 'production' && env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.MAIL_FROM ?? 'noreply@freellm.hasit.in',
        to: [to],
        subject: 'Verify your freellm email',
        text: `Welcome to freellm.\n\nVerify your email to start earning credits:\n${link}\n\nThis link expires in 24 hours.`,
      }),
    })
    if (!response.ok) {
      console.error('[email] resend rejected', response.status, await response.text().catch(() => ''))
      return { sent: false }
    }
    return { sent: true }
  }

  console.log(`[email:dev] verification for ${to}: ${link}`)
  return { sent: true, devLink: link }
}
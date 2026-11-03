import { useState } from 'react'
import { Card } from './ui'
import { useHaptics } from '../lib/useHaptics'

interface InviteComposerProps {
  link: string
}

const templates = [
  {
    platform: 'twitter',
    label: 'X (Twitter)',
    icon: '𝕏',
    text: (link: string) => `Just found freellm — free AI chat + earn credits for daily check-ins. Join me: ${link}`,
    color: 'hover:bg-black hover:text-white',
  },
  {
    platform: 'discord',
    label: 'Discord',
    icon: '🎮',
    text: (link: string) => `Free AI models on freellm. 500k credits each when you qualify. ${link}`,
    color: 'hover:bg-[#5865F2] hover:text-white',
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    icon: '💼',
    text: (link: string) => `Discovered freellm — free AI chat with credit rewards. Check it out: ${link}`,
    color: 'hover:bg-[#0A66C2] hover:text-white',
  },
  {
    platform: 'email',
    label: 'Email',
    icon: '✉️',
    text: (link: string) => `subject=Free AI chat + earn credits&body=Hey, check out freellm — free AI models, daily check-in rewards, and referral bonuses. Join me: ${link}`,
    color: 'hover:bg-[#EA4335] hover:text-white',
    isMailto: true,
  },
  {
    platform: 'sms',
    label: 'SMS',
    icon: '💬',
    text: (link: string) => `Free AI chat + earn credits: ${link}`,
    color: 'hover:bg-[#25D366] hover:text-white',
    isSms: true,
  },
  {
    platform: 'copy',
    label: 'Copy link',
    icon: '🔗',
    text: (link: string) => link,
    color: 'hover:bg-surface-2',
    isCopy: true,
  },
]

export default function InviteComposer({ link }: InviteComposerProps) {
  const { pulse } = useHaptics()
  const [copied, setCopied] = useState<string | null>(null)

  const handleShare = async (template: typeof templates[0]) => {
    try {
      if (template.isCopy) {
        await navigator.clipboard.writeText(template.text(link))
        setCopied('copy')
        setTimeout(() => setCopied(null), 2000)
        pulse('referral')
      } else if (template.isMailto) {
        window.location.href = `mailto:?${template.text(link)}`
      } else if (template.isSms) {
        window.location.href = `sms:?body=${encodeURIComponent(template.text(link))}`
      } else {
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(template.text(link))}`
        window.open(url, '_blank', 'noopener,noreferrer,width=550,height=420')
      }
      // Track share event
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'referral_share', { platform: template.platform })
      }
    } catch {
      // Ignore errors (e.g., clipboard blocked)
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h4 className="font-medium flex items-center gap-2">
        <span className="text-[14px]" aria-hidden="true">📤</span>
        Share your invite link
      </h4>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {templates.map((t) => (
          <button
            key={t.platform}
            type="button"
            onClick={() => handleShare(t)}
            className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg border border-line text-[11px] transition-colors ${t.color} ${copied === t.platform ? 'bg-accent/20 border-accent' : ''}`}
            aria-label={`Share via ${t.label}`}
          >
            <span className="text-[18px]" aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {copied && (
        <p className="text-center text-[12px] text-gain animate-pulse">Copied to clipboard!</p>
      )}
      <p className="text-center text-[11px] text-muted">
        Your link: <code className="num break-all">{link}</code>
      </p>
    </Card>
  )
}
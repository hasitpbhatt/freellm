import { useState, useMemo, useEffect } from "react"
import { Helmet } from "react-helmet-async"
import { providers, categories, type Provider } from "../data/providers"
import { Card } from "../components/ui"

const FEATURE_LABELS: Record<string, string> = {
  streaming: "Streaming",
  tools: "Tools",
  json_mode: "JSON mode",
  vision: "Vision",
  audio: "Audio",
  video: "Video",
  embeddings: "Embeddings",
  rerank: "Rerank",
  fine_tuning: "Fine-tuning",
  fallback: "Auto-failover",
  compound_ai: "Compound AI",
  grounding: "Grounding",
  caching: "Prompt caching",
  citations: "Citations",
  prompt_caching: "Prompt caching",
  responses_api: "Responses API",
  live_data: "Live data",
  model_discovery: "Model discovery",
  chat_ui: "Chat UI",
  tensor_parallel: "Tensor parallel",
  pipeline_parallel: "Pipeline parallel",
  speculative_decoding: "Speculative decoding",
  multimodal: "Multimodal",
  ultra_fast: "Ultra fast",
  dedicated_endpoints: "Dedicated endpoints",
  function_calling: "Function calling",
  rag: "RAG",
  per_second_billing: "Per-second billing",
  high_throughput: "High throughput",
  reasoning: "Reasoning",
  computer_use: "Computer use",
  long_context: "Long context",
  open_weights: "Open weights",
  code_specialized: "Code specialized",
  multilingual: "Multilingual",
  rag_optimized: "RAG optimized",
  real_time: "Real-time",
  offline: "Offline",
  private: "Private",
  no_rate_limits: "No rate limits",
  openai_compatible_server: "OpenAI-compatible server",
  continuous_batching: "Continuous batching",
  pagedattention: "PagedAttention",
  kubernetes: "Kubernetes native",
  open_source: "Open source",
}

const CATEGORY_COLORS: Record<string, string> = {
  gateway: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  direct: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  local: "bg-green-500/10 text-green-400 border-green-500/20",
}

function Badge({ children, className = "", variant = "default" }: { children: React.ReactNode; className?: string; variant?: "default" | "outline" | "ghost" }) {
  const base = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
  const variants = {
    default: "bg-accent/10 text-accent",
    outline: "border border-border text-muted hover:text-content hover:border-accent",
    ghost: "text-muted hover:text-content hover:bg-surface-2",
  }
  return <span className={`${base} ${variants[variant]} ${className}`}>{children}</span>
}

function StatLabel({ label, value }: { label: string; value?: number }) {
  return value ? <span className="text-xs text-muted">{label}: {value.toLocaleString()}</span> : null
}

// Generate JSON-LD structured data for ItemList
function generateStructuredData(filteredProviders: Provider[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Free LLM Providers & Gateways",
    description: "Compare free tiers, rate limits, and models across LLM providers and gateways",
    numberOfItems: filteredProviders.length,
    itemListElement: filteredProviders.map((provider, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: provider.name,
        description: provider.description,
        url: provider.website,
        brand: { "@type": "Brand", name: provider.name },
        category: provider.category,
        offers: {
          "@type": "Offer",
          name: "Free tier",
          description: provider.freeTier.notes,
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: provider.affiliateUrl,
        },
        additionalProperty: [
          { "@type": "PropertyValue", name: "Models", value: provider.freeTier.models.join(", ") },
          { "@type": "PropertyValue", name: "Category", value: provider.category },
          { "@type": "PropertyValue", name: "Best for", value: provider.bestFor?.join(", ") || "" },
        ],
      },
    })),
  }
}

export default function Providers() {
  const [category, setCategory] = useState<"all" | "gateway" | "direct" | "local">("all")
  const [search, setSearch] = useState("")
  const [jsonLd, setJsonLd] = useState<object | null>(null)

  const filtered = useMemo(() => {
    let list = providers
    if (category !== "all") list = list.filter((p) => p.category === category)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.freeTier.models.some((m) => m.toLowerCase().includes(q)) ||
          p.bestFor?.some((b) => b.toLowerCase().includes(q))
      )
    }
    return list.sort((a, b) => a.sortOrder - b.sortOrder)
  }, [category, search])

  // Update JSON-LD when filtered changes
  useEffect(() => {
    setJsonLd(generateStructuredData(filtered))
  }, [filtered])

  const pageTitle = "Free LLM Providers & Gateways — Compare Free Tiers | freellm"
  const pageDescription = "Compare 20+ free LLM providers: OpenRouter, Together, Groq, Fireworks, OpenAI, Anthropic, Google, Mistral, Cohere, xAI, plus local runners (Ollama, LM Studio, vLLM). Rate limits, models, features, and affiliate links."
  const pageUrl = "https://freellm.hasit.in/providers"
  const ogImage = "https://freellm.hasit.in/og-providers.png"

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta name="keywords" content="free LLM API, free LLM providers, OpenRouter, Together AI, Groq, Fireworks, DeepInfra, Cerebras, OpenAI free tier, Anthropic free tier, Google Gemini free, Mistral AI, Cohere, xAI Grok, Ollama, LM Studio, vLLM, local LLM, LLM comparison, free AI models" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={pageUrl} />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content="freellm" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={ogImage} />

        {/* JSON-LD Structured Data */}
        {jsonLd && (
          <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        )}
      </Helmet>

      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">Free LLM Providers & Gateways</h1>
          <p className="mt-1 text-sm text-muted">
            Compare free tiers, rate limits, and models across 20+ providers. Click through to sign up — affiliate links support freellm.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <input
              className="input pl-8"
              placeholder="Search providers, models, features, use cases…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search providers"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-content"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by category">
            <button
              className={`btn-sm ${category === "all" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCategory("all")}
              aria-pressed={category === "all"}
            >
              All ({providers.length})
            </button>
            {categories.map((c) => {
              const count = providers.filter((p) => p.category === c.id).length
              return (
                <button
                  key={c.id}
                  className={`btn-sm ${category === c.id ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setCategory(c.id)}
                  aria-pressed={category === c.id}
                >
                  {c.label} ({count})
                </button>
              )
            })}
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted">
            No providers match your filters.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Provider cards">
          {filtered.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>

        <section className="mt-8 p-4 rounded-lg bg-surface-2 text-sm text-muted" aria-labelledby="sources-heading">
          <h2 id="sources-heading" className="font-medium">Data sources & attribution</h2>
          <ul className="mt-2 list-disc list-inside space-y-1">
            <li>
              <a href="https://lmspeed.net/free" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                lmspeed.net/free
              </a>{" "}
              — Live benchmarks & free-tier rate limits across providers (primary source for rate limit data)
            </li>
            <li>
              Provider documentation & pricing pages (linked on each card)
            </li>
            <li>
              Community reports & GitHub issues for real-world limits
            </li>
          </ul>
          <h3 className="mt-3 font-medium">Disclosure</h3>
          <p className="mt-1">
            Links to providers are affiliate/referral links. If you sign up and make a purchase, freellm may earn a commission at no extra cost to you.
            This helps keep the platform running. We only list providers we genuinely recommend.
          </p>
        </section>

        <section className="mt-8 p-4 rounded-lg bg-surface-2 text-sm text-muted" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="font-medium">Quick guide</h2>
          <dl className="mt-2 space-y-3 text-sm">
            <div>
              <dt className="font-medium">Gateways vs Direct vs Local?</dt>
              <dd className="text-muted">Gateways (OpenRouter, Together) give one API key for 100s of models. Direct (OpenAI, Anthropic) are first-party with latest features. Local (Ollama, vLLM) run on your hardware — free, private, no limits.</dd>
            </div>
            <div>
              <dt className="font-medium">Which free tier is best?</dt>
              <dd className="text-muted">For volume: Google Gemini (1.5M tokens/min). For speed: Groq (300+ tok/s). For variety: OpenRouter (300+ models). For coding: Anthropic (Claude 3.5 Sonnet). For local: Ollama (easiest) or vLLM (production).</dd>
            </div>
            <div>
              <dt className="font-medium">Rate limits change?</dt>
              <dd className="text-muted">Yes, providers adjust limits frequently. We update from lmspeed.net/free and provider docs. Always check the provider&apos;s current docs before building production workloads.</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  )
}

function ProviderCard({ provider }: { provider: Provider }) {
  const ft = provider.freeTier
  const hasRateLimit = ft.requestsPerMin || ft.requestsPerDay || ft.tokensPerMin

  return (
    <Card className="flex flex-col gap-3 p-4" role="listitem">
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center overflow-hidden">
          <img
            src={provider.logo}
            alt={provider.name}
            className="h-8 w-8 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none"
              e.currentTarget.nextElementSibling?.classList.remove("hidden")
            }}
          />
          <span className="hidden text-2xl">{provider.name[0]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold truncate">{provider.name}</h2>
            <Badge className={CATEGORY_COLORS[provider.category]}>{provider.category}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted line-clamp-2">{provider.tagline}</p>
        </div>
      </div>

      <p className="text-sm text-muted line-clamp-3">{provider.description}</p>

      <div className="flex flex-wrap gap-1">
        {provider.freeTier.models.slice(0, 4).map((m) => (
          <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
        ))}
        {provider.freeTier.models.length > 4 && (
          <Badge variant="outline" className="text-xs">
            +{provider.freeTier.models.length - 4} more
          </Badge>
        )}
      </div>

      {hasRateLimit && (
        <dl className="grid grid-cols-2 gap-1 text-xs text-muted">
          <StatLabel label="Req/min" value={ft.requestsPerMin} />
          <StatLabel label="Req/day" value={ft.requestsPerDay} />
          <StatLabel label="Tokens/min" value={ft.tokensPerMin} />
        </dl>
      )}

      {ft.signupBonus && (
        <p className="text-xs text-success flex items-center gap-1">
          <span aria-hidden="true">✓</span> {ft.signupBonus}
        </p>
      )}

      {ft.notes && <p className="text-xs text-muted italic">{ft.notes}</p>}

      {provider.priceRange && (
        <p className="text-xs text-muted flex items-center gap-1">
          <span aria-hidden="true">💰</span> {provider.priceRange}
        </p>
      )}

      {provider.bestFor && provider.bestFor.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {provider.bestFor.slice(0, 4).map((b) => (
            <Badge key={b} variant="ghost" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20">{b.replace("_", " ")}</Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-auto pt-2 border-t border-border">
        {provider.features.slice(0, 6).map((f) => (
          <Badge key={f} variant="ghost" className="text-xs">
            {FEATURE_LABELS[f] ?? f}
          </Badge>
        ))}
        {provider.features.length > 6 && (
          <Badge variant="ghost" className="text-xs">
            +{provider.features.length - 6}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={provider.affiliateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary self-start flex-1 sm:flex-none text-center"
          data-provider={provider.id}
        >
          Try free →
        </a>
        {provider.pricingUrl && (
          <a href={provider.pricingUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
            Pricing
          </a>
        )}
        {provider.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
            Docs
          </a>
        )}
      </div>
    </Card>
  )
}

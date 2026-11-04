export interface Provider {
  id: string
  name: string
  tagline: string
  description: string
  website: string
  affiliateUrl: string
  logo: string
  category: "gateway" | "direct" | "local"
  freeTier: {
    requestsPerMin?: number
    requestsPerDay?: number
    tokensPerMin?: number
    models: string[]
    notes?: string
    signupBonus?: string
  }
  features: string[]
  pricingUrl?: string
  docsUrl?: string
  sortOrder: number
  // SEO / structured data
  priceRange?: string // e.g., "Free - $0.0001/1K tokens"
  bestFor?: string[] // ["coding", "chat", "reasoning", "vision", "local"]
  region?: string[] // ["global", "us", "eu", "asia"]
}

function withUtm(url: string, providerId: string): string {
  const u = new URL(url)
  u.searchParams.set("utm_source", "freellm")
  u.searchParams.set("utm_medium", "referral")
  u.searchParams.set("utm_campaign", "providers_page")
  u.searchParams.set("utm_content", providerId)
  return u.toString()
}

export const providers: Provider[] = [
  // --- GATEWAYS / AGGREGATORS ---
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "One API for 300+ models",
    description: "Unified OpenAI-compatible endpoint with automatic failover, caching, and per-model pricing. Free tier includes top open models like Llama 3.1, Mixtral, Gemma.",
    website: "https://openrouter.ai",
    affiliateUrl: withUtm("https://openrouter.ai", "openrouter"),
    logo: "/logos/openrouter.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 20,
      requestsPerDay: 1000,
      models: ["meta-llama/llama-3.1-8b-instruct", "mistralai/mixtral-8x7b-instruct", "google/gemma-2-9b-it", "meta-llama/llama-3.1-70b-instruct"],
      notes: "Free credits on signup; pay-as-you-go after. No rate limit on paid models. Auto-failover across providers.",
      signupBonus: "Free credits on signup"
    },
    features: ["streaming", "tools", "json_mode", "vision", "fallback", "caching"],
    pricingUrl: "https://openrouter.ai/pricing",
    docsUrl: "https://openrouter.ai/docs",
    sortOrder: 1,
    priceRange: "Free - pay per model",
    bestFor: ["model_variety", "fallback", "open_models", "cost_optimization"],
    region: ["global"]
  },
  {
    id: "together",
    name: "Together AI",
    tagline: "Fast inference for open models",
    description: "Dedicated endpoints for Llama, Mixtral, Qwen, DeepSeek and more. Serverless and dedicated GPU options. Generous free tier with $1 credit.",
    website: "https://together.ai",
    affiliateUrl: withUtm("https://together.ai", "together"),
    logo: "/logos/together.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 60,
      tokensPerMin: 60000,
      models: ["meta-llama/Llama-3.1-8B-Instruct", "mistralai/Mixtral-8x7B-Instruct-v0.1", "Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V2.5"],
      notes: "$1 free credit on signup. Serverless endpoints auto-scale to zero. Dedicated endpoints available.",
      signupBonus: "$1 free credit"
    },
    features: ["streaming", "tools", "json_mode", "vision", "fine_tuning", "dedicated_endpoints"],
    pricingUrl: "https://www.together.ai/pricing",
    docsUrl: "https://docs.together.ai",
    sortOrder: 2,
    priceRange: "Free - $0.10/1M tokens (serverless)",
    bestFor: ["open_models", "fine_tuning", "dedicated_endpoints", "high_throughput"],
    region: ["global", "us", "eu"]
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Instant inference on LPU",
    description: "Custom LPU hardware delivers 10x faster token generation (~300-500 tok/s). Free tier for popular open models with sub-second latency.",
    website: "https://groq.com",
    affiliateUrl: withUtm("https://console.groq.com", "groq"),
    logo: "/logos/groq.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 30,
      requestsPerDay: 14400,
      tokensPerMin: 6000,
      models: ["llama-3.1-8b-instant", "gemma2-9b-it", "mixtral-8x7b-32768", "llama-3.3-70b-versatile"],
      notes: "Rate limits are generous; speed is the differentiator. LPU = deterministic low latency.",
      signupBonus: "Free tier access"
    },
    features: ["streaming", "tools", "json_mode", "ultra_fast"],
    pricingUrl: "https://groq.com/pricing",
    docsUrl: "https://console.groq.com/docs",
    sortOrder: 3,
    priceRange: "Free - custom enterprise",
    bestFor: ["speed", "real_time", "low_latency", "high_volume"],
    region: ["global", "us"]
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    tagline: "Compound AI systems platform",
    description: "Optimized inference for Llama, Mixtral, Qwen, DeepSeek. Function calling, JSON mode, and compound systems (RAG, agents, function calling).",
    website: "https://fireworks.ai",
    affiliateUrl: withUtm("https://fireworks.ai", "fireworks"),
    logo: "/logos/fireworks.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 60,
      tokensPerMin: 120000,
      models: ["accounts/fireworks/models/llama-v3p1-8b-instruct", "accounts/fireworks/models/mixtral-8x7b-instruct", "accounts/fireworks/models/deepseek-v3"],
      notes: "$1 free credit. Compound AI features (function calling, RAG, agents) included free.",
      signupBonus: "$1 free credit"
    },
    features: ["streaming", "tools", "json_mode", "vision", "compound_ai", "function_calling", "rag"],
    pricingUrl: "https://fireworks.ai/pricing",
    docsUrl: "https://docs.fireworks.ai",
    sortOrder: 4,
    priceRange: "Free - $0.20/1M tokens",
    bestFor: ["compound_ai", "agents", "rag", "function_calling", "open_models"],
    region: ["global", "us"]
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    tagline: "Serverless inference, per-second billing",
    description: "Run any open model serverless. Pay per second of compute. Supports 50+ models including LLMs, embeddings, audio, image generation.",
    website: "https://deepinfra.com",
    affiliateUrl: withUtm("https://deepinfra.com", "deepinfra"),
    logo: "/logos/deepinfra.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 60,
      models: ["meta-llama/Meta-Llama-3.1-8B-Instruct", "mistralai/Mixtral-8x7B-Instruct-v0.1", "Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V2.5"],
      notes: "Free tier with rate limits. Per-second billing after — very cheap for burst workloads. Supports embeddings, audio, image models.",
      signupBonus: "Free tier access"
    },
    features: ["streaming", "tools", "json_mode", "vision", "embeddings", "audio", "image", "per_second_billing"],
    pricingUrl: "https://deepinfra.com/pricing",
    docsUrl: "https://deepinfra.com/docs",
    sortOrder: 5,
    priceRange: "Free - $0.10-0.50/1M tokens",
    bestFor: ["cost_optimization", "burst_workloads", "multi_modal", "embeddings", "audio"],
    region: ["global", "us"]
  },
  {
    id: "cerebras",
    name: "Cerebras",
    tagline: "Wafer-scale engine, fastest inference",
    description: "CS-3 systems deliver 2,100 tokens/sec on Llama 3.1 70B. Free API access for developers via waitlist. Unmatched speed for large models.",
    website: "https://cerebras.ai",
    affiliateUrl: withUtm("https://cloud.cerebras.ai", "cerebras"),
    logo: "/logos/cerebras.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 10,
      models: ["llama3.1-70b", "llama3.1-8b"],
      notes: "Access via waitlist. Unmatched speed for large models (2100 tok/s on 70B).",
      signupBonus: "Waitlist access"
    },
    features: ["streaming", "tools", "ultra_fast"],
    pricingUrl: "https://cerebras.ai/pricing",
    docsUrl: "https://docs.cerebras.ai",
    sortOrder: 6,
    priceRange: "Free (waitlist) - enterprise",
    bestFor: ["speed", "large_models", "low_latency", "enterprise"],
    region: ["us"]
  },
  {
    id: "sambanova",
    name: "SambaNova",
    tagline: "Enterprise AI platform, free dev tier",
    description: "SN40L Reconfigurable Dataflow Unit. Pre-trained and fine-tuned models. Free developer sandbox for testing.",
    website: "https://sambanova.ai",
    affiliateUrl: withUtm("https://cloud.sambanova.ai", "sambanova"),
    logo: "/logos/sambanova.svg",
    category: "gateway",
    freeTier: {
      requestsPerMin: 20,
      models: ["Meta-Llama-3.1-8B-Instruct", "Meta-Llama-3.1-70B-Instruct"],
      notes: "Sandbox environment. Production requires enterprise contract. High throughput on RDU.",
      signupBonus: "Free sandbox"
    },
    features: ["streaming", "tools", "json_mode", "high_throughput"],
    pricingUrl: "https://sambanova.ai/pricing",
    docsUrl: "https://docs.sambanova.ai",
    sortOrder: 7,
    priceRange: "Free sandbox - enterprise",
    bestFor: ["enterprise", "high_throughput", "large_models"],
    region: ["us"]
  },

  // --- DIRECT PROVIDERS ---
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT-4o, o1, and the frontier",
    description: "Industry-leading models with best-in-class reasoning, tools, and multimodal capabilities. Free tier via API credits on signup.",
    website: "https://openai.com",
    affiliateUrl: withUtm("https://platform.openai.com/signup", "openai"),
    logo: "/logos/openai.svg",
    category: "direct",
    freeTier: {
      requestsPerMin: 500,
      tokensPerMin: 200000,
      models: ["gpt-4o-mini", "gpt-3.5-turbo", "gpt-4o", "o1-preview", "o1-mini"],
      notes: "$5 free credit for new accounts (expires 30 days). Paid tier unlocks GPT-4o, o1 series. Best reasoning & tools.",
      signupBonus: "$5 free credit (30 days)"
    },
    features: ["streaming", "tools", "json_mode", "vision", "audio", "fine_tuning", "responses_api", "reasoning", "computer_use"],
    pricingUrl: "https://openai.com/pricing",
    docsUrl: "https://platform.openai.com/docs",
    sortOrder: 10,
    priceRange: "Free $5 credit - $2.50-15/1M tokens",
    bestFor: ["reasoning", "coding", "tools", "vision", "audio", "agents", "frontier_models"],
    region: ["global"]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    tagline: "Claude 3.5 Sonnet — best for coding",
    description: "Constitutional AI with strong reasoning and 200k context. Free tier via API credits. Sonnet 3.5 widely considered best for coding.",
    website: "https://anthropic.com",
    affiliateUrl: withUtm("https://console.anthropic.com", "anthropic"),
    logo: "/logos/anthropic.svg",
    category: "direct",
    freeTier: {
      requestsPerMin: 50,
      tokensPerMin: 40000,
      models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
      notes: "$5 free credit. Sonnet 3.5 is widely considered best for coding. 200k context window. Prompt caching for cost savings.",
      signupBonus: "$5 free credit"
    },
    features: ["streaming", "tools", "json_mode", "vision", "citations", "prompt_caching", "long_context", "computer_use"],
    pricingUrl: "https://anthropic.com/pricing",
    docsUrl: "https://docs.anthropic.com",
    sortOrder: 11,
    priceRange: "Free $5 credit - $0.25-15/1M tokens",
    bestFor: ["coding", "reasoning", "long_context", "analysis", "writing"],
    region: ["global"]
  },
  {
    id: "google",
    name: "Google AI (Gemini)",
    tagline: "Gemini 1.5 Pro — 2M context",
    description: "Massive context window (2M tokens), native multimodal, generous free tier. Vertex AI for enterprise. Best free tier for high-volume.",
    website: "https://ai.google.dev",
    affiliateUrl: withUtm("https://aistudio.google.com", "google"),
    logo: "/logos/google.svg",
    category: "direct",
    freeTier: {
      requestsPerMin: 60,
      requestsPerDay: 1500,
      tokensPerMin: 1000000,
      models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.5-flash-8b"],
      notes: "Best free tier for high-volume / long-context. Rate limits are per-model. 2M context on Pro. Native video/audio understanding.",
      signupBonus: "Generous free tier"
    },
    features: ["streaming", "tools", "json_mode", "vision", "audio", "video", "grounding", "caching", "long_context", "multimodal"],
    pricingUrl: "https://ai.google.dev/pricing",
    docsUrl: "https://ai.google.dev/docs",
    sortOrder: 12,
    priceRange: "Free - $0.075-3.50/1M tokens",
    bestFor: ["long_context", "multimodal", "video", "audio", "high_volume", "cost_optimization"],
    region: ["global"]
  },
  {
    id: "mistral",
    name: "Mistral AI",
    tagline: "Open-weight frontier models",
    description: "Mistral Large, Nemo, Codestral. Strong open models with API access. La Plateforme for developers. Open weights for self-hosting.",
    website: "https://mistral.ai",
    affiliateUrl: withUtm("https://console.mistral.ai", "mistral"),
    logo: "/logos/mistral.svg",
    category: "direct",
    freeTier: {
      requestsPerMin: 60,
      models: ["mistral-small-latest", "codestral-latest", "open-mistral-nemo", "mistral-large-latest"],
      notes: "Free tier on La Plateforme. Open weights available for self-hosting. Codestral specialized for code.",
      signupBonus: "Free tier access"
    },
    features: ["streaming", "tools", "json_mode", "vision", "fine_tuning", "open_weights", "code_specialized"],
    pricingUrl: "https://mistral.ai/pricing",
    docsUrl: "https://docs.mistral.ai",
    sortOrder: 13,
    priceRange: "Free - $0.25-8/1M tokens",
    bestFor: ["coding", "open_weights", "self_hosting", "european", "multilingual"],
    region: ["global", "eu"]
  },
  {
    id: "cohere",
    name: "Cohere",
    tagline: "Command R+ — enterprise RAG",
    description: "Optimized for retrieval-augmented generation. Strong multilingual (100+ languages). Free trial credits. Command R+ excels at RAG and tool use.",
    website: "https://cohere.com",
    affiliateUrl: withUtm("https://dashboard.cohere.com", "cohere"),
    logo: "/logos/cohere.svg",
    category: "direct",
    freeTier: {
      requestsPerMin: 100,
      models: ["command-r-plus", "command-r", "command-light", "embed-english-v3.0", "embed-multilingual-v3.0"],
      notes: "Free trial credits. Command R+ excels at RAG and tool use. Best-in-class embeddings & rerank.",
      signupBonus: "Free trial credits"
    },
    features: ["streaming", "tools", "json_mode", "embeddings", "rerank", "multilingual", "rag_optimized"],
    pricingUrl: "https://cohere.com/pricing",
    docsUrl: "https://docs.cohere.com",
    sortOrder: 14,
    priceRange: "Free trial - $0.50-3/1M tokens",
    bestFor: ["rag", "embeddings", "rerank", "multilingual", "enterprise", "tool_use"],
    region: ["global"]
  },
  {
    id: "xai",
    name: "xAI",
    tagline: "Grok — real-time via X",
    description: "Models with live access to X (Twitter) data. Grok-2 and Grok-2 mini. API in beta. Unique real-time data integration.",
    website: "https://x.ai",
    affiliateUrl: withUtm("https://console.x.ai", "xai"),
    logo: "/logos/xai.svg",
    category: "direct",
    freeTier: {
      requestsPerMin: 30,
      models: ["grok-2", "grok-2-mini"],
      notes: "Beta access. Unique real-time data integration from X platform. Good for news, trends, real-time analysis.",
      signupBonus: "Beta access"
    },
    features: ["streaming", "tools", "json_mode", "vision", "live_data", "real_time"],
    pricingUrl: "https://x.ai/pricing",
    docsUrl: "https://docs.x.ai",
    sortOrder: 15,
    priceRange: "Beta - TBD",
    bestFor: ["real_time", "news", "trends", "social_analysis", "live_data"],
    region: ["global"]
  },

  // --- LOCAL RUNNERS ---
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Run models locally, zero config",
    description: "Download and run Llama, Qwen, Mistral, Gemma locally. Mac/Windows/Linux. No API keys, no cloud, total privacy. Open source.",
    website: "https://ollama.com",
    affiliateUrl: withUtm("https://ollama.com", "ollama"),
    logo: "/logos/ollama.svg",
    category: "local",
    freeTier: {
      models: ["llama3.1:8b", "qwen2.5:7b", "mistral:7b", "gemma2:9b", "phi3:mini", "llama3.1:70b", "deepseek-r1:7b"],
      notes: "Unlimited. Only limited by your hardware (RAM/VRAM). 100% private, offline-capable.",
      signupBonus: "Free forever"
    },
    features: ["streaming", "tools", "vision", "embeddings", "multimodal", "offline", "private", "no_rate_limits"],
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/README.md",
    sortOrder: 20,
    priceRange: "Free (hardware only)",
    bestFor: ["privacy", "offline", "no_rate_limits", "cost_zero", "experimentation", "local_dev"],
    region: ["local"]
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    tagline: "Desktop app for local LLMs",
    description: "GUI for discovering, downloading, and running GGUF models. Built-in OpenAI-compatible local server. Cross-platform. Model discovery built-in.",
    website: "https://lmstudio.ai",
    affiliateUrl: withUtm("https://lmstudio.ai", "lmstudio"),
    logo: "/logos/lmstudio.svg",
    category: "local",
    freeTier: {
      models: ["Any GGUF from Hugging Face (1000s)"],
      notes: "Completely free. Community edition is fully featured. Built-in model search & download.",
      signupBonus: "Free forever"
    },
    features: ["streaming", "tools", "json_mode", "vision", "model_discovery", "chat_ui", "openai_compatible_server", "offline", "private"],
    docsUrl: "https://lmstudio.ai/docs",
    sortOrder: 21,
    priceRange: "Free (hardware only)",
    bestFor: ["ease_of_use", "model_discovery", "gui", "openai_compatible", "offline", "private"],
    region: ["local"]
  },
  {
    id: "vllm",
    name: "vLLM",
    tagline: "High-throughput serving engine",
    description: "PagedAttention, continuous batching, tensor parallelism. Production-grade. OpenAI-compatible API. Kubernetes native. Apache 2.0.",
    website: "https://vllm.ai",
    affiliateUrl: withUtm("https://vllm.ai", "vllm"),
    logo: "/logos/vllm.svg",
    category: "local",
    freeTier: {
      models: ["Any Hugging Face model"],
      notes: "Open source (Apache 2.0). Self-hosted — you pay for GPUs only. Best throughput for production serving.",
      signupBonus: "Open source"
    },
    features: ["streaming", "tools", "json_mode", "vision", "tensor_parallel", "pipeline_parallel", "speculative_decoding", "continuous_batching", "pagedattention", "kubernetes", "open_source"],
    docsUrl: "https://docs.vllm.ai",
    sortOrder: 22,
    priceRange: "Free (hardware only)",
    bestFor: ["production", "high_throughput", "scaling", "kubernetes", "enterprise", "open_source"],
    region: ["local", "cloud"]
  }
]

export const categories = [
  { id: "gateway", label: "Gateways & Aggregators", description: "One API, hundreds of models. Best for flexibility and model switching." },
  { id: "direct", label: "Direct Providers", description: "First-party APIs from model creators. Best for latest features and reliability." },
  { id: "local", label: "Local Runners", description: "Run on your hardware. Zero cost, total privacy, no rate limits." }
] as const

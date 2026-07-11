// Inline SVG brand marks for AI providers. The panel's CSP blocks remote
// images, so logos must be embedded. These are simplified, hand-drawn SVG
// approximations in each brand's real colors — recognizable, not pixel-perfect
// reproductions of the official trademarks.
import type { ComponentType, SVGProps } from "react";

type LogoProps = SVGProps<SVGSVGElement>;
export type LogoComponent = ComponentType<LogoProps>;

export function OpenAILogo(props: LogoProps) {
  // Simplified interlocking-knot mark evoking OpenAI's blossom, in its green.
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#10a37f" }} {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5.2a3.4 3.4 0 0 1 5.9 2.3v4.9a3.4 3.4 0 0 1-1.7 2.95" />
        <path d="M12 5.2a3.4 3.4 0 0 0-5.9 2.3v4.9a3.4 3.4 0 0 0 1.7 2.95" />
        <path d="M6.1 9.55a3.4 3.4 0 0 0-1.7 4.4l2.45 4.24a3.4 3.4 0 0 0 3.25 1.7" />
        <path d="M17.9 9.55a3.4 3.4 0 0 1 1.7 4.4l-2.45 4.24a3.4 3.4 0 0 1-3.25 1.7" />
        <path d="M12 12v6.2" />
        <path d="M12 12 6.7 9" />
        <path d="M12 12 17.3 9" />
      </g>
    </svg>
  );
}

export function AnthropicLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: "#d97757" }} {...props}>
      <path d="M12 3.5 19.5 20.5h-3.1l-1.5-3.7H9.1l-1.5 3.7H4.5L12 3.5Zm0 5.6-1.85 4.55h3.7L12 9.1Z" />
    </svg>
  );
}

export function GeminiLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#4285f4" }} {...props}>
      <path
        fill="currentColor"
        d="M12 2c.35 5.3 4.7 9.65 10 10-5.3.35-9.65 4.7-10 10-.35-5.3-4.7-9.65-10-10C7.3 11.65 11.65 7.3 12 2Z"
      />
    </svg>
  );
}

export function GroqLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#f55036" }} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
      <path
        d="M12 7.5a4.5 4.5 0 1 0 3.2 7.68V16.8a.9.9 0 0 1-1.8 0v-.9a4.5 4.5 0 0 1-1.4.22 4.5 4.5 0 0 1 0-9V7.5Zm0 1.8a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z"
        fill="#fff"
      />
    </svg>
  );
}

export function DeepSeekLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#4d6bfe" }} {...props}>
      <path
        fill="currentColor"
        d="M21 6.2c-.5.9-1.4 1.3-2.2 1.8-.6.4-1.3.7-1.7 1.4-.5.9-.4 2-.9 2.9-.7 1.4-2.2 2.2-3.7 2.6-2.3.6-4.9.3-6.9-1-1.1-.7-2-1.8-2.4-3 .8.7 1.8 1.2 2.9 1.3-1.4-.9-2.4-2.4-2.6-4 .5.4 1.1.7 1.7.8-1.2-1.1-1.6-3-.9-4.5.2 1.6 1.4 3 2.9 3.7 1.5.7 3.2.8 4.8.4-.4-1.4.1-3 1.2-3.9 1-.8 2.4-1 3.6-.5-.4.2-.7.5-.9.9.7-.2 1.5-.1 2.1.3-.3.1-.6.3-.8.6.8.1 1.5.5 1.9 1.2-.1-.5-.1-1-.1-1.5.5.6 1 1.2 1.2 2Z"
      />
    </svg>
  );
}

export function OpenRouterLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#6467f2" }} {...props}>
      <path
        fill="currentColor"
        d="M4 12h4l2-2 4 4 2-2h4M4 8h3l1.5 1.5M4 16h3l1.5-1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fillOpacity="0"
      />
      <circle cx="18" cy="12" r="2.5" fill="currentColor" />
      <circle cx="6" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

export function MistralLogo(props: LogoProps) {
  // Mistral's signature block: horizontal colour bands (yellow→red). Columns
  // are drawn separately so the notches between them stay transparent (no
  // hardcoded background colour that would mismatch the card).
  const cols = [3, 9, 15];
  const bands = [
    { y: 4, c: "#f7d046" },
    { y: 8, c: "#f2a73b" },
    { y: 12, c: "#ee792f" },
    { y: 16, c: "#eb5829" },
  ];
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {bands.map((b, bi) =>
        cols.map((x, ci) => {
          // Punch out the top two rows of the middle and right columns to
          // suggest the "M" gaps.
          if (bi < 2 && (ci === 1 || (ci === 2 && bi === 0))) return null;
          return <rect key={`${bi}-${ci}`} x={x} y={b.y} width="6" height="4" fill={b.c} />;
        })
      )}
    </svg>
  );
}

export function TogetherLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#0f6fff" }} {...props}>
      <circle cx="8" cy="8" r="3.5" fill="currentColor" />
      <circle cx="16" cy="8" r="3.5" fill="currentColor" opacity="0.55" />
      <circle cx="8" cy="16" r="3.5" fill="currentColor" opacity="0.55" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
    </svg>
  );
}

export function XAILogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: "#e5e7eb" }} {...props}>
      <path d="M4 4h3.6l4.4 6 4.4-6H20l-6.2 8.4L20 20h-3.6l-4.4-6-4.4 6H4l6.2-7.6L4 4Z" />
    </svg>
  );
}

export function GenericProviderLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ color: "#9ca3af" }} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" opacity="0.2" />
      <path
        d="M12 7v10M7 12h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// logoForBaseUrl maps a provider's base URL to a brand logo by hostname, so it
// works regardless of what the user named the provider.
export function logoForBaseUrl(baseUrl: string): LogoComponent {
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = baseUrl;
  }
  host = host.toLowerCase();
  if (host.includes("openai.com")) return OpenAILogo;
  if (host.includes("anthropic.com")) return AnthropicLogo;
  if (host.includes("googleapis.com") || host.includes("generativelanguage")) return GeminiLogo;
  if (host.includes("groq.com")) return GroqLogo;
  if (host.includes("deepseek.com")) return DeepSeekLogo;
  if (host.includes("openrouter.ai")) return OpenRouterLogo;
  if (host.includes("mistral.ai")) return MistralLogo;
  if (host.includes("together.")) return TogetherLogo;
  if (host.includes("x.ai")) return XAILogo;
  return GenericProviderLogo;
}

export const PRESET_LOGOS: Record<string, LogoComponent> = {
  openai: OpenAILogo,
  anthropic: AnthropicLogo,
  gemini: GeminiLogo,
  groq: GroqLogo,
  deepseek: DeepSeekLogo,
  openrouter: OpenRouterLogo,
  mistral: MistralLogo,
  together: TogetherLogo,
  xai: XAILogo,
  custom: GenericProviderLogo,
};

/** Public example boards (client-safe). Each is a live board over radar services anyone can open, copy and adapt. */
export type BoardTemplate = { slug: string; name: string; title: string; blurb: string; accent: string; theme: "dark" | "light"; serviceIds: string[]; sla?: number };
export const DEFAULT_SLA = 0.999;

export const BOARD_TEMPLATES: BoardTemplate[] = [
  { slug: "google-workspace", name: "Google Workspace", title: "Google Workspace status", accent: "#1a73e8", theme: "light",
    blurb: "Gmail, Calendar, Drive, Docs, Meet and Google sign-in, checked every 5 minutes.",
    serviceIds: ["mail-google-com", "calendar-google-com", "drive-google-com", "docs-google-com", "meet-google-com", "accounts-google-com"] },
  { slug: "google-cloud", name: "Google Cloud", title: "Google Cloud status", accent: "#34a853", theme: "dark",
    blurb: "Console, APIs, Cloud Storage, BigQuery, Vertex AI, Gemini API and Firebase.",
    serviceIds: ["console-cloud-google-com", "www-googleapis-com", "storage-googleapis-com", "bigquery-googleapis-com", "us-central1-aiplatform-googleapis-com", "generativelanguage-googleapis-com", "firebase-googleapis-com", "identitytoolkit-googleapis-com"] },
  { slug: "microsoft-365", name: "Microsoft 365", title: "Microsoft 365 status", accent: "#0f6cbd", theme: "light",
    blurb: "Teams, Outlook, Microsoft sign-in, Graph, Entra and the admin centre.",
    serviceIds: ["teams-microsoft-com", "outlook-office-com", "login-microsoftonline-com", "graph-microsoft-com", "entra-microsoft-com", "admin-microsoft-com", "web-microsoft365-com"] },
  { slug: "developer-stack", name: "Developer stack", title: "Engineering tools status", accent: "#8b5cf6", theme: "dark",
    blurb: "GitHub, Bitbucket, Atlassian, Stripe, Twilio, Datadog and Notion: the tools a product team ships with.",
    serviceIds: ["api-github-com", "pipelines-actions-githubusercontent-com", "api-bitbucket-org", "api-atlassian-com", "api-stripe-com", "api-twilio-com", "api-datadoghq-com", "api-notion-com"] },
  { slug: "atlassian-bitbucket", name: "Atlassian & Bitbucket", title: "Atlassian & Bitbucket status", accent: "#0c66e4", theme: "light",
    blurb: "Bitbucket, Jira, Trello, Opsgenie, Loom and Atlassian sign-in. Includes a disruption we saw 26 minutes before Atlassian posted it.",
    serviceIds: ["api-bitbucket-org", "www-atlassian-com", "api-atlassian-com", "id-atlassian-com", "api-trello-com", "api-opsgenie-com", "www-loom-com"] },
  { slug: "slack", name: "Slack", title: "Slack status", accent: "#611f69", theme: "dark",
    blurb: "The Slack app, Web API, incoming webhooks and file delivery.",
    serviceIds: ["app-slack-com", "slack-com", "hooks-slack-com", "files-slack-com"] },
  { slug: "stripe", name: "Stripe", title: "Stripe status", accent: "#635bff", theme: "dark",
    blurb: "Stripe API, Dashboard, Stripe.js and hosted Checkout: everything a payment flow touches.",
    serviceIds: ["api-stripe-com", "dashboard-stripe-com", "js-stripe-com", "checkout-stripe-com"] },
  { slug: "telegram", name: "Telegram", title: "Telegram status", accent: "#229ed9", theme: "light",
    blurb: "telegram.org, Telegram Web, the Bot API and t.me links.",
    serviceIds: ["telegram-org", "web-telegram-org", "api-telegram-org", "t-me"] },
  { slug: "reddit", name: "Reddit", title: "Reddit status", accent: "#ff4500", theme: "dark",
    blurb: "reddit.com, the Reddit API, old Reddit, static assets and image hosting.",
    serviceIds: ["www-reddit-com", "oauth-reddit-com", "old-reddit-com", "www-redditstatic-com", "i-redd-it"] },
  { slug: "sales-and-support", name: "Sales & support", title: "Customer tools status", accent: "#f97316", theme: "light",
    blurb: "Salesforce, HubSpot, Zendesk, Slack, Zoom and DocuSign.",
    serviceIds: ["www-salesforce-com", "www-hubspot-com", "www-zendesk-com", "app-slack-com", "api-zoom-us", "account-docusign-com"] },
];

export const templateBySlug = (slug: string) => BOARD_TEMPLATES.find((t) => t.slug === slug) ?? null;

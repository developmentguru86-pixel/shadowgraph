/**
 * Internet Outage Radar catalog: services probed every 5 minutes.
 * Probe the SERVICE endpoint (API / app host), not the marketing site. Any HTTP answer < 500 means "reachable"
 * (401/403/404 are normal for unauthenticated API roots). Region canaries are cloud-native regional endpoints:
 * they answer with 4xx when healthy and are the ground truth for "is this region up".
 */
export type RadarEntry = { id: string; name: string; category: string; url: string; region?: string; provider?: string };

const svc = (category: string, list: Array<[string, string]>): RadarEntry[] =>
  list.map(([name, url]) => ({ id: new URL(url).host.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), name, category, url }));

const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1",
  "eu-central-1", "eu-central-2", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "eu-south-1",
  "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2", "ap-south-1", "me-central-1", "af-south-1",
];

export const RADAR_CATALOG_VERSION = "2026-10-08.4";

// Additional regional canaries: DynamoDB (the Oct 2025 us-east-1 outage started there) and Google Cloud Run.
const DDB_REGIONS = ["us-east-1", "us-east-2", "us-west-2", "eu-central-1", "eu-west-1", "ap-northeast-1", "ap-southeast-1", "ap-south-1"];
const GCP_REGIONS = ["us-central1", "us-east1", "us-east4", "us-west1", "europe-west1", "europe-west3", "europe-west4", "europe-west2", "asia-northeast1", "asia-southeast1"];
const CANARIES: RadarEntry[] = [
  ...DDB_REGIONS.map((r) => ({ id: `aws-ddb-${r}`, name: `AWS DynamoDB ${r}`, category: "Cloud region canary", url: `https://dynamodb.${r}.amazonaws.com/`, region: r, provider: "Amazon Web Services" })),
  ...GCP_REGIONS.map((r) => ({ id: `gcp-run-${r}`, name: `Google Cloud Run ${r}`, category: "Cloud region canary", url: `https://${r}-run.googleapis.com/`, region: r, provider: "Google Cloud" })),
];

/** Compact catalog block: "Name|host" lines -> entries probing https://host/ */
const block = (category: string, lines: string): RadarEntry[] =>
  lines.trim().split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, host] = l.split("|").map((x) => x.trim());
    return { id: host.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), name, category, url: `https://${host}/` };
  });

const EXTENDED: RadarEntry[] = [
  ...block("Cloud & hosting", `
    AWS Console|console.aws.amazon.com
    Azure Portal|portal.azure.com
    Google Cloud Console|console.cloud.google.com
    Oracle Cloud|cloud.oracle.com
    IBM Cloud|cloud.ibm.com
    Hetzner Cloud API|api.hetzner.cloud
    OVHcloud API|eu.api.ovh.com
    IONOS|www.ionos.de
    Vultr API|api.vultr.com
    Linode API|api.linode.com
    Scaleway API|api.scaleway.com
    Let's Encrypt ACME|acme-v02.api.letsencrypt.org
    GoDaddy|www.godaddy.com
    Namecheap|www.namecheap.com
    Cloudflare Dashboard|dash.cloudflare.com
    Akamai|www.akamai.com
    Snowflake|app.snowflake.com
    Databricks|accounts.cloud.databricks.com
    Elastic Cloud|cloud.elastic.co
    Grafana Cloud|grafana.com
    Confluent Cloud|confluent.cloud
    Pinecone API|api.pinecone.io
    Weights & Biases API|api.wandb.ai
    BigQuery API|bigquery.googleapis.com
    Cloud Storage API|storage.googleapis.com
  `),
  ...block("Enterprise SaaS", `
    Salesforce|www.salesforce.com
    Workday|www.workday.com
    ServiceNow|www.servicenow.com
    SAP|www.sap.com
    Oracle|www.oracle.com
    Adobe|www.adobe.com
    Autodesk|www.autodesk.com
    Atlassian ID|id.atlassian.com
    Stack Overflow|stackoverflow.com
    Medium|medium.com
    Substack|substack.com
    WordPress.com|wordpress.com
    Wix|www.wix.com
    Squarespace|www.squarespace.com
    Webflow|webflow.com
    HubSpot|www.hubspot.com
    Mailchimp|mailchimp.com
    Klaviyo|www.klaviyo.com
    Typeform|www.typeform.com
    SurveyMonkey|www.surveymonkey.com
    Zapier|zapier.com
    Make|www.make.com
    n8n|n8n.io
    Retool|retool.com
    Postman|www.postman.com
    1Password|1password.com
    Bitwarden|bitwarden.com
    Okta|www.okta.com
    Cisco Duo|duo.com
    CrowdStrike|www.crowdstrike.com
    Zscaler|www.zscaler.com
    Palo Alto Networks|www.paloaltonetworks.com
    Fortinet|www.fortinet.com
    Cisco|www.cisco.com
    Webex|www.webex.com
    RingCentral|www.ringcentral.com
    Aircall|aircall.io
    Freshdesk|www.freshworks.com
    Help Scout|www.helpscout.com
    Front|front.com
    Gong|www.gong.io
    Pipedrive|www.pipedrive.com
    Zoho|www.zoho.com
    Xero|www.xero.com
    QuickBooks|quickbooks.intuit.com
    Sage|www.sage.com
    lexoffice|www.lexoffice.de
    DATEV|www.datev.de
    Personio|www.personio.de
    Deel|www.deel.com
    Remote|remote.com
    Rippling|www.rippling.com
    Gusto|gusto.com
    ADP|www.adp.com
    BambooHR|www.bamboohr.com
    Greenhouse|www.greenhouse.io
    Indeed|www.indeed.com
    Glassdoor|www.glassdoor.com
    XING|www.xing.com
    StepStone|www.stepstone.de
    Slack|app.slack.com
    Jira Software|www.atlassian.com
    ClickUp|clickup.com
    Loom|www.loom.com
    Grammarly|www.grammarly.com
    DeepL API|api.deepl.com
  `),
  ...block("AI tools", `
    GitHub Copilot API|api.githubcopilot.com
    Cursor|cursor.com
    Replit|replit.com
    v0|v0.dev
    Lovable|lovable.dev
    Bolt|bolt.new
    Midjourney|www.midjourney.com
    Runway|runwayml.com
    Character.AI|character.ai
    Poe|poe.com
    You.com|you.com
    Jasper|www.jasper.ai
    Stability AI API|api.stability.ai
    Fireworks AI API|api.fireworks.ai
    DeepSeek API|api.deepseek.com
    xAI API|api.x.ai
    OpenRouter|openrouter.ai
    Cerebras API|api.cerebras.ai
  `),
  ...block("Media & news", `
    Disney+|www.disneyplus.com
    Hulu|www.hulu.com
    Max|www.max.com
    Prime Video|www.primevideo.com
    Apple TV|tv.apple.com
    Apple Music|music.apple.com
    SoundCloud|soundcloud.com
    Deezer|www.deezer.com
    Tidal|tidal.com
    Vimeo|vimeo.com
    BBC|www.bbc.co.uk
    CNN|edition.cnn.com
    New York Times|www.nytimes.com
    The Guardian|www.theguardian.com
    Reuters|www.reuters.com
    Bloomberg|www.bloomberg.com
    Wall Street Journal|www.wsj.com
    Financial Times|www.ft.com
    Washington Post|www.washingtonpost.com
    Forbes|www.forbes.com
    TechCrunch|techcrunch.com
    The Verge|www.theverge.com
    Wired|www.wired.com
    ESPN|www.espn.com
    IMDb|www.imdb.com
    Wikipedia|en.wikipedia.org
    Internet Archive|archive.org
    Quora|www.quora.com
    Tumblr|www.tumblr.com
    Threads|www.threads.net
    Bluesky|bsky.app
    Mastodon|mastodon.social
  `),
  ...block("E-commerce & retail", `
    Walmart|www.walmart.com
    Target|www.target.com
    Best Buy|www.bestbuy.com
    Costco|www.costco.com
    Home Depot|www.homedepot.com
    IKEA|www.ikea.com
    AliExpress|www.aliexpress.com
    Temu|www.temu.com
    SHEIN|www.shein.com
    Alibaba|www.alibaba.com
    Rakuten|www.rakuten.co.jp
    Mercado Libre|www.mercadolibre.com
    Flipkart|www.flipkart.com
    ASOS|www.asos.com
    H&M|www2.hm.com
    Zara|www.zara.com
    Nike|www.nike.com
    Adidas|www.adidas.com
    Apple|www.apple.com
    Samsung|www.samsung.com
    Dell|www.dell.com
    Lenovo|www.lenovo.com
    HP|www.hp.com
  `),
  ...block("Travel & mobility", `
    Expedia|www.expedia.com
    Kayak|www.kayak.com
    Skyscanner|www.skyscanner.net
    Tripadvisor|www.tripadvisor.com
    Ryanair|www.ryanair.com
    easyJet|www.easyjet.com
    Emirates|www.emirates.com
    Qatar Airways|www.qatarairways.com
    United Airlines|www.united.com
    Delta|www.delta.com
    American Airlines|www.aa.com
    British Airways|www.britishairways.com
    Air France|wwws.airfrance.fr
    KLM|www.klm.com
    Lyft|www.lyft.com
    Bolt|bolt.eu
    FlixBus|www.flixbus.com
    Trainline|www.thetrainline.com
    Hertz|www.hertz.com
    Sixt|www.sixt.com
    Marriott|www.marriott.com
    Hilton|www.hilton.com
  `),
  ...block("Gaming", `
    EA|www.ea.com
    Ubisoft|www.ubisoft.com
    Battle.net|battle.net
    Riot Games|www.riotgames.com
    Minecraft|www.minecraft.net
    Nintendo|www.nintendo.com
    Steam Community|steamcommunity.com
    GOG|www.gog.com
    itch.io|itch.io
    Chess.com|www.chess.com
    Lichess|lichess.org
  `),
  ...block("Crypto & markets", `
    Blockchain.com|www.blockchain.com
    Etherscan|etherscan.io
    KuCoin|www.kucoin.com
    Bybit|www.bybit.com
    OKX|www.okx.com
    Crypto.com|crypto.com
    Gemini|www.gemini.com
    Bitstamp|www.bitstamp.net
    Ledger|www.ledger.com
    MetaMask|metamask.io
    Uniswap|app.uniswap.org
    OpenSea|opensea.io
    Robinhood|robinhood.com
    eToro|www.etoro.com
    Interactive Brokers|www.interactivebrokers.com
    Charles Schwab|www.schwab.com
    Fidelity|www.fidelity.com
    Vanguard|investor.vanguard.com
    TradingView|www.tradingview.com
    Yahoo Finance|finance.yahoo.com
    Investing.com|www.investing.com
    Nasdaq|www.nasdaq.com
    SEC EDGAR|www.sec.gov
  `),
  ...block("Banks & payments", `
    Visa|www.visa.com
    Mastercard|www.mastercard.com
    American Express|www.americanexpress.com
    Chase|www.chase.com
    Bank of America|www.bankofamerica.com
    Wells Fargo|www.wellsfargo.com
    Citi|www.citi.com
    HSBC|www.hsbc.com
    Barclays|www.barclays.co.uk
    Santander|www.santander.com
    ING|www.ing.com
    UniCredit|www.unicredit.it
    UBS|www.ubs.com
    Payoneer|www.payoneer.com
    Skrill|www.skrill.com
    Venmo|venmo.com
    Cash App|cash.app
    Affirm|www.affirm.com
    Worldline|worldline.com
    Fiserv|www.fiserv.com
    Global Payments|www.globalpayments.com
    Razorpay|razorpay.com
    Paytm|paytm.com
    PayU|corporate.payu.com
  `),
  ...block("DACH", `
    ORF|orf.at
    Der Standard|www.derstandard.at
    Krone|www.krone.at
    willhaben|www.willhaben.at
    ÖBB|www.oebb.at
    Austrian Post|www.post.at
    A1 Telekom|www.a1.net
    Magenta AT|www.magenta.at
    Austrian Airlines|www.austrian.com
    Spiegel|www.spiegel.de
    Bild|www.bild.de
    Zeit|www.zeit.de
    FAZ|www.faz.net
    Süddeutsche|www.sueddeutsche.de
    Tagesschau|www.tagesschau.de
    n-tv|www.n-tv.de
    heise|www.heise.de
    golem|www.golem.de
    t-online|www.t-online.de
    WEB.DE|web.de
    GMX|www.gmx.net
    Otto|www.otto.de
    MediaMarkt|www.mediamarkt.de
    idealo|www.idealo.de
    CHECK24|www.check24.de
    mobile.de|www.mobile.de
    AutoScout24|www.autoscout24.de
    Kleinanzeigen|www.kleinanzeigen.de
    Lieferando|www.lieferando.de
    About You|www.aboutyou.de
    Deutsche Bahn|www.bahn.de
    Lufthansa|www.lufthansa.com
    DHL|www.dhl.de
    DPD|www.dpd.com
    Hermes|www.myhermes.de
    Deutsche Telekom|www.telekom.de
    Vodafone DE|www.vodafone.de
    O2 DE|www.o2online.de
    Sparkasse|www.sparkasse.de
    DKB|www.dkb.de
    comdirect|www.comdirect.de
    Postbank|www.postbank.de
    SRF|www.srf.ch
    NZZ|www.nzz.ch
    SBB|www.sbb.ch
    SWISS|www.swiss.com
    Swisscom|www.swisscom.ch
  `),
  ...block("Türkiye", `
    Trendyol|www.trendyol.com
    Hepsiburada|www.hepsiburada.com
    n11|www.n11.com
    sahibinden|www.sahibinden.com
    Yemeksepeti|www.yemeksepeti.com
    Getir|getir.com
    Turkish Airlines|www.turkishairlines.com
    Pegasus|www.flypgs.com
    Garanti BBVA|www.garantibbva.com.tr
    İş Bankası|www.isbank.com.tr
    Akbank|www.akbank.com
    Yapı Kredi|www.yapikredi.com.tr
    Ziraat Bankası|www.ziraatbank.com.tr
    Papara|www.papara.com
    Hürriyet|www.hurriyet.com.tr
    Sözcü|www.sozcu.com.tr
    e-Devlet|www.turkiye.gov.tr
    Turkcell|www.turkcell.com.tr
    Vodafone TR|www.vodafone.com.tr
    Türk Telekom|www.turktelekom.com.tr
    Borsa İstanbul|www.borsaistanbul.com
    KAP|www.kap.org.tr
    BtcTurk|www.btcturk.com
    Paribu|www.paribu.com
  `),
];

const BASE: RadarEntry[] = [
  ...AWS_REGIONS.map((r) => ({
    id: `aws-s3-${r}`, name: `AWS S3 ${r}`, category: "Cloud region canary",
    url: `https://s3.${r}.amazonaws.com/`, region: r, provider: "Amazon Web Services",
  })),
  ...svc("Payments & fintech", [
    ["Stripe API", "https://api.stripe.com/"], ["PayPal API", "https://api-m.paypal.com/"], ["Adyen Checkout", "https://checkout-test.adyen.com/"],
    ["Square API", "https://connect.squareup.com/"], ["Wise API", "https://api.wise.com/"], ["Checkout.com API", "https://api.checkout.com/"],
    ["Mollie API", "https://api.mollie.com/"], ["GoCardless API", "https://api.gocardless.com/"], ["Plaid API", "https://production.plaid.com/"],
    ["Braintree", "https://api.braintreegateway.com/"], ["Klarna", "https://api.klarna.com/"], ["Coinbase API", "https://api.coinbase.com/"],
    ["Kraken API", "https://api.kraken.com/"], ["Binance API", "https://api.binance.com/"], ["Bitpanda", "https://api.bitpanda.com/"],
    ["SumUp API", "https://api.sumup.com/"], ["Paddle API", "https://api.paddle.com/"], ["Recurly", "https://v3.recurly.com/"],
    ["Marqeta", "https://api.marqeta.com/"], ["Onfido API", "https://api.onfido.com/"], ["Sumsub API", "https://api.sumsub.com/"],
    ["Revolut", "https://www.revolut.com/"], ["N26", "https://n26.com/"], ["Trade Republic", "https://traderepublic.com/"],
    ["Scalable Capital", "https://de.scalable.capital/"], ["Qonto", "https://qonto.com/"], ["Monzo", "https://monzo.com/"],
    ["Erste George (AT)", "https://george.sparkasse.at/"], ["Raiffeisen (AT)", "https://www.raiffeisen.at/"], ["Bank Austria", "https://www.bankaustria.at/"],
    ["Deutsche Bank", "https://www.deutsche-bank.de/"], ["Commerzbank", "https://www.commerzbank.de/"], ["ING Deutschland", "https://www.ing.de/"],
  ]),
  ...svc("Developer platforms", [
    ["GitHub API", "https://api.github.com/"], ["GitLab", "https://gitlab.com/"], ["Bitbucket API", "https://api.bitbucket.org/"],
    ["npm registry", "https://registry.npmjs.org/"], ["PyPI", "https://pypi.org/"], ["Docker Hub", "https://hub.docker.com/"],
    ["Docker registry", "https://registry-1.docker.io/"], ["Vercel API", "https://api.vercel.com/"], ["Netlify API", "https://api.netlify.com/"],
    ["Heroku API", "https://api.heroku.com/"], ["DigitalOcean API", "https://api.digitalocean.com/"], ["Cloudflare API", "https://api.cloudflare.com/"],
    ["Fastly API", "https://api.fastly.com/"], ["Datadog US", "https://api.datadoghq.com/"], ["Datadog EU", "https://api.datadoghq.eu/"],
    ["New Relic", "https://api.newrelic.com/"], ["Sentry", "https://sentry.io/"], ["PagerDuty API", "https://api.pagerduty.com/"],
    ["CircleCI", "https://circleci.com/"], ["Terraform Cloud", "https://app.terraform.io/"], ["Linear API", "https://api.linear.app/"],
    ["Atlassian API", "https://api.atlassian.com/"], ["Auth0 CDN", "https://cdn.auth0.com/"], ["Okta", "https://login.okta.com/"],
    ["Supabase", "https://api.supabase.com/"], ["MongoDB Atlas", "https://cloud.mongodb.com/"], ["Neon", "https://console.neon.tech/"],
    ["Render API", "https://api.render.com/"], ["Fly.io API", "https://api.fly.io/"], ["Railway", "https://backboard.railway.app/"],
    ["Firebase", "https://firebase.googleapis.com/"], ["Google APIs", "https://www.googleapis.com/"], ["Azure Management", "https://management.azure.com/"],
  ]),
  ...svc("Communication APIs", [
    ["Twilio API", "https://api.twilio.com/"], ["SendGrid API", "https://api.sendgrid.com/"], ["Mailgun API", "https://api.mailgun.net/"],
    ["Postmark API", "https://api.postmarkapp.com/"], ["Resend API", "https://api.resend.com/"], ["Vonage API", "https://api.nexmo.com/"],
    ["Slack API", "https://slack.com/api/"], ["Discord API", "https://discord.com/api/"], ["Zoom API", "https://api.zoom.us/"],
    ["Microsoft Graph", "https://graph.microsoft.com/"], ["Microsoft login", "https://login.microsoftonline.com/"], ["Google accounts", "https://accounts.google.com/"],
    ["Intercom API", "https://api.intercom.io/"], ["HubSpot API", "https://api.hubapi.com/"], ["Salesforce login", "https://login.salesforce.com/"],
    ["Zendesk", "https://www.zendesk.com/"], ["Segment API", "https://api.segment.io/"], ["Mixpanel API", "https://api.mixpanel.com/"],
    ["Amplitude API", "https://api2.amplitude.com/"],
  ]),
  ...svc("AI APIs", [
    ["OpenAI API", "https://api.openai.com/"], ["Anthropic API", "https://api.anthropic.com/"], ["Google Gemini API", "https://generativelanguage.googleapis.com/"],
    ["Mistral API", "https://api.mistral.ai/"], ["Cohere API", "https://api.cohere.com/"], ["Replicate API", "https://api.replicate.com/"],
    ["Together AI", "https://api.together.xyz/"], ["Hugging Face", "https://huggingface.co/"], ["ElevenLabs API", "https://api.elevenlabs.io/"],
    ["Groq API", "https://api.groq.com/"], ["Perplexity", "https://www.perplexity.ai/"], ["ChatGPT", "https://chatgpt.com/"], ["Claude", "https://claude.ai/"],
  ]),
  ...svc("SaaS & productivity", [
    ["Notion API", "https://api.notion.com/"], ["Airtable API", "https://api.airtable.com/"], ["Figma API", "https://api.figma.com/"],
    ["Dropbox API", "https://api.dropboxapi.com/"], ["Box API", "https://api.box.com/"], ["Shopify", "https://www.shopify.com/"],
    ["Contentful API", "https://api.contentful.com/"], ["Sanity API", "https://api.sanity.io/"], ["Canva", "https://www.canva.com/"],
    ["Miro API", "https://api.miro.com/"], ["Asana API", "https://app.asana.com/api/1.0/"], ["Monday.com API", "https://api.monday.com/"],
    ["Trello API", "https://api.trello.com/"], ["Calendly API", "https://api.calendly.com/"], ["DocuSign", "https://account.docusign.com/"],
    ["Teams", "https://teams.microsoft.com/"], ["Outlook web", "https://outlook.office.com/"], ["Gmail", "https://mail.google.com/"],
    ["iCloud", "https://www.icloud.com/"],
  ]),
  ...svc("Consumer platforms", [
    ["Netflix", "https://www.netflix.com/"], ["Spotify API", "https://api.spotify.com/"], ["YouTube", "https://www.youtube.com/"],
    ["Twitch", "https://www.twitch.tv/"], ["Reddit", "https://www.reddit.com/"], ["X", "https://x.com/"], ["Instagram", "https://www.instagram.com/"],
    ["Facebook", "https://www.facebook.com/"], ["LinkedIn", "https://www.linkedin.com/"], ["TikTok", "https://www.tiktok.com/"],
    ["WhatsApp Web", "https://web.whatsapp.com/"], ["Telegram", "https://telegram.org/"], ["Steam", "https://store.steampowered.com/"],
    ["Epic Games", "https://store.epicgames.com/"], ["Roblox", "https://www.roblox.com/"], ["PlayStation", "https://www.playstation.com/"],
    ["Xbox", "https://www.xbox.com/"], ["Amazon", "https://www.amazon.com/"], ["Amazon DE", "https://www.amazon.de/"], ["eBay", "https://www.ebay.com/"],
    ["Etsy", "https://www.etsy.com/"], ["Zalando", "https://www.zalando.de/"], ["Booking.com", "https://www.booking.com/"], ["Airbnb", "https://www.airbnb.com/"],
    ["Uber", "https://www.uber.com/"], ["Wolt", "https://wolt.com/"], ["Duolingo", "https://www.duolingo.com/"], ["Pinterest", "https://www.pinterest.com/"],
    ["Snapchat", "https://www.snapchat.com/"],
  ]),
];

const MORE: RadarEntry[] = [
  ...block("Developer APIs", `
    Algolia|www.algolia.com
    Mapbox API|api.mapbox.com
    Google Maps API|maps.googleapis.com
    HERE API|router.hereapi.com
    OpenWeather API|api.openweathermap.org
    Clerk API|api.clerk.com
    WorkOS API|api.workos.com
    Stytch API|api.stytch.com
    Firebase Auth|identitytoolkit.googleapis.com
    Pusher|pusher.com
    Ably|rest.ably.io
    Stream API|chat.stream-io-api.com
    LaunchDarkly|app.launchdarkly.com
    Statsig API|api.statsig.com
    PostHog|us.posthog.com
    Heap|heapanalytics.com
    Hotjar|www.hotjar.com
    FullStory|www.fullstory.com
    LogRocket|logrocket.com
    Bugsnag|www.bugsnag.com
    Rollbar API|api.rollbar.com
    Honeycomb API|api.honeycomb.io
    Logz.io|app.logz.io
    Splunk|www.splunk.com
    Sumo Logic|www.sumologic.com
    Dynatrace|www.dynatrace.com
    Opsgenie API|api.opsgenie.com
    incident.io API|api.incident.io
    Statuspage|www.atlassian.com/software/statuspage
    Better Stack|betterstack.com
    UptimeRobot API|api.uptimerobot.com
    Checkly API|api.checklyhq.com
    GitHub Actions results|pipelines.actions.githubusercontent.com
    GitHub raw|raw.githubusercontent.com
    GitHub Packages|ghcr.io
    Quay|quay.io
    Google Container Registry|gcr.io
    Maven Central|repo1.maven.org
    crates.io|crates.io
    RubyGems|rubygems.org
    Packagist|packagist.org
    NuGet API|api.nuget.org
    Go proxy|proxy.golang.org
    Homebrew|formulae.brew.sh
    Debian mirrors|deb.debian.org
    Ubuntu archive|archive.ubuntu.com
    Alpine CDN|dl-cdn.alpinelinux.org
    jsDelivr|cdn.jsdelivr.net
    unpkg|unpkg.com
    cdnjs|cdnjs.cloudflare.com
    Google Fonts|fonts.googleapis.com
    Font Awesome|fontawesome.com
    reCAPTCHA|www.recaptcha.net
    hCaptcha|hcaptcha.com
    Cloudinary API|api.cloudinary.com
    imgix|www.imgix.com
    Mux API|api.mux.com
    Bunny CDN|bunny.net
    Backblaze B2|api.backblazeb2.com
    Wasabi|s3.wasabisys.com
    Turso|api.turso.tech
    PlanetScale|api.planetscale.com
    Upstash|console.upstash.com
    Convex|dashboard.convex.dev
    Prisma Data Platform|console.prisma.io
    Hasura|cloud.hasura.io
    Appwrite|cloud.appwrite.io
    Pocketbase|pocketbase.io
    Deno Deploy|dash.deno.com
    Bun|bun.sh
    Cloudflare Workers|workers.cloudflare.com
    Expo|expo.dev
    App Store Connect|appstoreconnect.apple.com
    Google Play Console|play.google.com
    Firebase Hosting|firebase.google.com
    OneSignal API|api.onesignal.com
    Customer.io API|api.customer.io
    Braze|www.braze.com
    Iterable API|api.iterable.com
    Brevo API|api.brevo.com
    Mailjet API|api.mailjet.com
    SparkPost API|api.sparkpost.com
    Plivo API|api.plivo.com
    MessageBird API|rest.messagebird.com
    Sinch|www.sinch.com
    Infobip|www.infobip.com
    Telnyx API|api.telnyx.com
    Bandwidth|www.bandwidth.com
    Agora|www.agora.io
    Daily API|api.daily.co
    LiveKit|livekit.io
    Whereby|whereby.com
    Google Meet|meet.google.com
    Calendly|calendly.com
    Cal.com|app.cal.com
  `),
  ...block("Identity & security", `
    Microsoft Entra|entra.microsoft.com
    Okta Developer|developer.okta.com
    Auth0|auth0.com
    Ping Identity|www.pingidentity.com
    OneLogin|www.onelogin.com
    JumpCloud|console.jumpcloud.com
    Keycloak|www.keycloak.org
    Yubico|www.yubico.com
    LastPass|www.lastpass.com
    Dashlane|www.dashlane.com
    Keeper|www.keepersecurity.com
    Proton|proton.me
    Tutanota|tuta.com
    NordVPN|nordvpn.com
    ExpressVPN|www.expressvpn.com
    Tailscale|login.tailscale.com
    Twingate|www.twingate.com
    Cloudflare Zero Trust|one.dash.cloudflare.com
    Netskope|www.netskope.com
    SentinelOne|www.sentinelone.com
    Microsoft Defender|security.microsoft.com
    Sophos|www.sophos.com
    ESET|www.eset.com
    Kaspersky|www.kaspersky.com
    Malwarebytes|www.malwarebytes.com
    Snyk API|api.snyk.io
    Wiz|www.wiz.io
    Vanta|www.vanta.com
    Drata|drata.com
    HackerOne|hackerone.com
    Bugcrowd|www.bugcrowd.com
    VirusTotal|www.virustotal.com
    Shodan|www.shodan.io
    Have I Been Pwned API|haveibeenpwned.com
    DigiCert|www.digicert.com
    Sectigo|www.sectigo.com
    GlobalSign|www.globalsign.com
    Entrust|www.entrust.com
  `),
  ...block("Productivity & collaboration", `
    Google Drive|drive.google.com
    Google Docs|docs.google.com
    Google Calendar|calendar.google.com
    OneDrive|onedrive.live.com
    SharePoint|www.office.com
    Microsoft 365 admin|admin.microsoft.com
    Outlook.com|outlook.live.com
    Yahoo Mail|mail.yahoo.com
    Evernote|evernote.com
    Todoist API|api.todoist.com
    Basecamp|basecamp.com
    Wrike|www.wrike.com
    Smartsheet|app.smartsheet.com
    Coda|coda.io
    Obsidian|obsidian.md
    Craft|www.craft.do
    Pitch|pitch.com
    Prezi|prezi.com
    Lucid|lucid.app
    Whimsical|whimsical.com
    Excalidraw|excalidraw.com
    Mural|www.mural.co
    Adobe Express|new.express.adobe.com
    Adobe Sign|secure.adobesign.com
    PandaDoc|app.pandadoc.com
    HelloSign|app.hellosign.com
    WeTransfer|wetransfer.com
    Frame.io|frame.io
    Vimeo API|api.vimeo.com
    YouTube API|youtube.googleapis.com
    Discourse|meta.discourse.org
    Mattermost|mattermost.com
    Rocket.Chat|www.rocket.chat
    Element|app.element.io
    Signal|signal.org
    Viber|www.viber.com
    WeChat|web.wechat.com
    LINE|line.me
    KakaoTalk|www.kakaocorp.com
  `),
  ...block("Asia-Pacific & LatAm", `
    Baidu|www.baidu.com
    Bilibili|www.bilibili.com
    Weibo|weibo.com
    Taobao|www.taobao.com
    JD.com|www.jd.com
    Pinduoduo|www.pinduoduo.com
    Tencent|www.tencent.com
    Alipay|www.alipay.com
    Naver|www.naver.com
    Coupang|www.coupang.com
    Kakao|www.kakao.com
    Yahoo Japan|www.yahoo.co.jp
    Mercari|jp.mercari.com
    LINE Pay|pay.line.me
    PayPay|paypay.ne.jp
    Shopee|shopee.sg
    Lazada|www.lazada.sg
    Grab|www.grab.com
    Gojek|www.gojek.com
    Tokopedia|www.tokopedia.com
    Sea Group|www.sea.com
    Zomato|www.zomato.com
    Swiggy|www.swiggy.com
    PhonePe|www.phonepe.com
    Reliance Jio|www.jio.com
    Infosys|www.infosys.com
    TCS|www.tcs.com
    Canva AU|www.canva.com/en_au
    Atlassian AU|www.atlassian.com/au
    Afterpay|www.afterpay.com
    Xero AU|www.xero.com/au
    Seek|www.seek.com.au
    Nubank|nubank.com.br
    Mercado Pago|www.mercadopago.com.br
    PicPay|picpay.com
    Itaú|www.itau.com.br
    Bradesco|banco.bradesco
    iFood|www.ifood.com.br
    Rappi|www.rappi.com
    Globo|www.globo.com
    Magazine Luiza|www.magazineluiza.com.br
    Americanas|www.americanas.com.br
  `),
  ...block("Europe", `
    BBC iPlayer|www.bbc.co.uk/iplayer
    Sky|www.sky.com
    BT|www.bt.com
    Vodafone UK|www.vodafone.co.uk
    Tesco|www.tesco.com
    Sainsbury's|www.sainsburys.co.uk
    Argos|www.argos.co.uk
    Ocado|www.ocado.com
    Just Eat|www.just-eat.co.uk
    Deliveroo|deliveroo.co.uk
    Rightmove|www.rightmove.co.uk
    Zoopla|www.zoopla.co.uk
    Gov.uk|www.gov.uk
    NHS|www.nhs.uk
    HSBC UK|www.hsbc.co.uk
    Lloyds|www.lloydsbank.com
    NatWest|www.natwest.com
    Starling|www.starlingbank.com
    Nationwide|www.nationwide.co.uk
    Le Monde|www.lemonde.fr
    Le Figaro|www.lefigaro.fr
    Orange FR|www.orange.fr
    Free FR|www.free.fr
    SNCF Connect|www.sncf-connect.com
    Leboncoin|www.leboncoin.fr
    Cdiscount|www.cdiscount.com
    Fnac|www.fnac.com
    BNP Paribas|mabanque.bnpparibas
    Société Générale|particuliers.sg.fr
    Crédit Agricole|www.credit-agricole.fr
    Doctolib|www.doctolib.fr
    BlaBlaCar|www.blablacar.fr
    Back Market|www.backmarket.fr
    Vinted|www.vinted.fr
    El País|elpais.com
    Marca|www.marca.com
    Telefónica|www.telefonica.com
    Movistar|www.movistar.es
    Renfe|www.renfe.com
    Idealista|www.idealista.com
    BBVA|www.bbva.es
    CaixaBank|www.caixabank.es
    Corriere della Sera|www.corriere.it
    Repubblica|www.repubblica.it
    TIM|www.tim.it
    Trenitalia|www.trenitalia.com
    Intesa Sanpaolo|www.intesasanpaolo.com
    Subito|www.subito.it
    NOS|nos.nl
    Bol.com|www.bol.com
    Coolblue|www.coolblue.nl
    Thuisbezorgd|www.thuisbezorgd.nl
    ABN AMRO|www.abnamro.nl
    Rabobank|www.rabobank.nl
    bunq|www.bunq.com
    NS|www.ns.nl
    KPN|www.kpn.com
    Allegro|allegro.pl
    Onet|www.onet.pl
    PKO BP|www.pkobp.pl
    mBank|www.mbank.pl
    Seznam|www.seznam.cz
    Alza|www.alza.cz
    Spotify SE|open.spotify.com
    Klarna SE|www.klarna.com/se
    SVT|www.svt.se
    Nordea|www.nordea.com
    Swedbank|www.swedbank.se
    DNB|www.dnb.no
    Finn.no|www.finn.no
    Vipps|vipps.no
    MobilePay|mobilepay.dk
    DR|www.dr.dk
    Danske Bank|danskebank.dk
    Yle|yle.fi
    OP|www.op.fi
    Zooplus|www.zooplus.de
    HelloFresh|www.hellofresh.de
    Delivery Hero|www.deliveryhero.com
    N26 API|api.tech26.de
    Solaris|www.solarisgroup.com
    Raisin|www.raisin.com
    Wefox|www.wefox.com
    Celonis|www.celonis.com
    Personio API|api.personio.de
    GetYourGuide|www.getyourguide.com
    Trivago|www.trivago.com
    Omio|www.omio.com
    Tier|www.tier.app
    Free Now|www.free-now.com
    Bitvavo|bitvavo.com
    Kraken EU|www.kraken.com
    Swissquote|www.swissquote.com
    PostFinance|www.postfinance.ch
    Galaxus|www.galaxus.ch
    Ricardo|www.ricardo.ch
    Twint|www.twint.ch
  `),
  ...block("Education & health", `
    Coursera|www.coursera.org
    Udemy|www.udemy.com
    edX|www.edx.org
    Khan Academy|www.khanacademy.org
    Codecademy|www.codecademy.com
    LeetCode|leetcode.com
    Kaggle|www.kaggle.com
    Quizlet|quizlet.com
    Chegg|www.chegg.com
    Canvas LMS|www.instructure.com
    Moodle|moodle.org
    Blackboard|www.blackboard.com
    Google Classroom|classroom.google.com
    Zoom Education|explore.zoom.us
    arXiv|arxiv.org
    PubMed|pubmed.ncbi.nlm.nih.gov
    Nature|www.nature.com
    ScienceDirect|www.sciencedirect.com
    ResearchGate|www.researchgate.net
    Google Scholar|scholar.google.com
    WHO|www.who.int
    Mayo Clinic|www.mayoclinic.org
    WebMD|www.webmd.com
    Epic MyChart|www.mychart.org
    Teladoc|www.teladoc.com
    Zocdoc|www.zocdoc.com
  `),
  ...block("Commerce platforms", `
    Shopify Admin|admin.shopify.com
    Shopify CDN|cdn.shopify.com
    WooCommerce|woocommerce.com
    BigCommerce|www.bigcommerce.com
    Magento|business.adobe.com
    Salesforce Commerce|www.salesforce.com/commerce
    commercetools|commercetools.com
    Gumroad|gumroad.com
    Lemon Squeezy|www.lemonsqueezy.com
    Etsy API|openapi.etsy.com
    eBay API|api.ebay.com
    Amazon Seller Central|sellercentral.amazon.com
    Amazon Pay|pay.amazon.com
    Google Pay|pay.google.com
    Apple Pay|www.apple.com/apple-pay
    Shop Pay|shop.app
    Afterpay API|global-api.afterpay.com
    Klarna Playground|api.playground.klarna.com
    Riskified|www.riskified.com
    Signifyd|www.signifyd.com
    Sift|sift.com
    Avalara|www.avalara.com
    TaxJar API|api.taxjar.com
    Shippo API|api.goshippo.com
    EasyPost API|api.easypost.com
    ShipStation|www.shipstation.com
    FedEx|www.fedex.com
    UPS|www.ups.com
    USPS|www.usps.com
    Royal Mail|www.royalmail.com
    PostNL|www.postnl.nl
    La Poste|www.laposte.fr
    GLS|gls-group.com
    Maersk|www.maersk.com
    Flexport|www.flexport.com
  `),
  ...block("AI infrastructure", `
    Azure OpenAI|oai.azure.com
    AWS Bedrock|bedrock-runtime.us-east-1.amazonaws.com
    Vertex AI|us-central1-aiplatform.googleapis.com
    Modal|modal.com
    Baseten|www.baseten.co
    RunPod API|api.runpod.io
    Lambda Labs|cloud.lambdalabs.com
    CoreWeave|www.coreweave.com
    Crusoe|crusoe.ai
    Lightning AI|lightning.ai
    LangSmith API|api.smith.langchain.com
    LlamaIndex Cloud|cloud.llamaindex.ai
    Qdrant Cloud|cloud.qdrant.io
    Chroma|www.trychroma.com
    Voyage AI API|api.voyageai.com
    Jina AI API|api.jina.ai
    AssemblyAI API|api.assemblyai.com
    Deepgram API|api.deepgram.com
    Speechmatics|www.speechmatics.com
    Suno|suno.com
    Leonardo AI|app.leonardo.ai
    Ideogram|ideogram.ai
    Black Forest Labs API|api.bfl.ai
    Luma AI|lumalabs.ai
    Pika|pika.art
    HeyGen|www.heygen.com
    Synthesia|www.synthesia.io
    Notion AI|www.notion.so
    Glean|www.glean.com
    Harvey|www.harvey.ai
  `),
];

export const RADAR_CATALOG: RadarEntry[] = [...new Map([...CANARIES, ...BASE, ...EXTENDED, ...MORE].map((e) => [e.id, e])).values()];

/**
 * Ground-truth registry: official, machine-readable status pages (Atlassian Statuspage or incident.io,
 * both expose GET /api/v2/incidents.json). Verified reachable on 2026-10-10 (182 pages).
 * Key = registrable domain of the monitored service ("org"); value = status page host.
 * Services whose registrable domain differs from the org that runs them are listed in ORG_ALIASES.
 */
export const STATUS_REGISTRY_VERSION = "2026-10-10.1";

const RAW = `
atlassian.com status.atlassian.com|discord.com discordstatus.com|netlify.com www.netlifystatus.com|vercel.com www.vercel-status.com
twilio.com status.twilio.com|github.com www.githubstatus.com|trello.com trello.status.atlassian.com|figma.com status.figma.com
npmjs.org status.npmjs.org|mailgun.net status.mailgun.com|datadoghq.com status.datadoghq.com|cloudflare.com www.cloudflarestatus.com
dropboxapi.com status.dropbox.com|anthropic.com status.anthropic.com|hubspot.com status.hubspot.com|sendgrid.com status.sendgrid.com
mongodb.com status.mongodb.com|zoom.us status.zoom.us|bitbucket.org bitbucket.status.atlassian.com|kraken.com status.kraken.com
render.com status.render.com|cloudinary.com status.cloudinary.com|openai.com status.openai.com|mapbox.com status.mapbox.com
notion.so www.notion-status.com|pinecone.io status.pinecone.io|elastic.co status.elastic.co|digitalocean.com status.digitalocean.com
reddit.com www.redditstatus.com|sentry.io status.sentry.io|coinbase.com status.coinbase.com|grafana.com status.grafana.com
linear.app linearstatus.com|box.com status.box.com|asana.com status.asana.com|pypi.org status.python.org
fly.io status.flyio.net|segment.io status.segment.com|amplitude.com status.amplitude.com|circleci.com status.circleci.com
newrelic.com status.newrelic.com|supabase.com status.supabase.com|nexmo.com vonageapi.statuspage.io|mixpanel.com www.mixpanelstatus.com
planetscale.com www.planetscalestatus.com|docker.com www.dockerstatus.com|contentful.com www.contentfulstatus.com|sanity.io www.sanity-status.com
shopify.com www.shopifystatus.com|airtable.com status.airtable.com|monday.com status.monday.com|terraform.io status.hashicorp.com
resend.com resend-status.com|miro.com status.miro.com|canva.com www.canvastatus.com|launchdarkly.com status.launchdarkly.com
mux.com status.mux.com|daily.co status.daily.co|honeycomb.io status.honeycomb.io|cohere.com status.cohere.com
opsgenie.com opsgenie.status.atlassian.com|plivo.com status.plivo.com|clerk.com status.clerk.com|upstash.com status.upstash.com
ably.io status.ably.com|bunny.net status.bunny.net|workos.com status.workos.com|pusher.com status.pusher.com
groq.com groqstatus.com|perplexity.ai status.perplexity.com|brevo.com status.brevo.com|expo.dev status.expo.dev
incident.io status.incident.io|marqeta.com status.marqeta.com|rollbar.com status.rollbar.com|elevenlabs.io status.elevenlabs.io
telnyx.com status.telnyx.com|plaid.com status.plaid.com|onesignal.com status.onesignal.com|convex.dev status.convex.dev
wise.com status.wise.com|statsig.com status.statsig.com|robinhood.com status.robinhood.com|jumpcloud.com status.jumpcloud.com
recurly.com status.recurly.com|gocardless.com www.gocardless-status.com|bitstamp.net status.bitstamp.net|snyk.io status.snyk.io
paddle.com paddlestatus.com|1password.com 1password.statuspage.io|squareup.com www.issquareup.com|retool.com status.retool.com
webflow.com status.webflow.com|squarespace.com status.squarespace.com|gemini.com status.gemini.com|wix.com status.wix.com
typeform.com status.typeform.com|etherscan.io status.etherscan.io|gusto.com status.gusto.com|rippling.com status.rippling.com
tailscale.com status.tailscale.com|postman.com status.postman.com|grammarly.com status.grammarly.com|smartsheet.com status.smartsheet.com
coda.io status.coda.io|vimeo.com www.vimeostatus.com|aircall.io status.aircall.io|front.com status.frontapp.com
klaviyo.com status.klaviyo.com|zapier.com status.zapier.com|lucid.app status.lucid.co|snowflake.com status.snowflake.com
wetransfer.com wetransfer.statuspage.io|cursor.com status.cursor.com|v0.dev www.vercel-status.com|linode.com status.linode.com
confluent.cloud status.confluent.cloud|deepgram.com status.deepgram.com|assemblyai.com status.assemblyai.com|goshippo.com status.goshippo.com
sift.com status.sift.com|baseten.co status.baseten.co|avalara.com status.avalara.com|taxjar.com status.taxjar.com
stability.ai status.stability.ai|pandadoc.com status.pandadoc.com|fireworks.ai status.fireworks.ai|hellosign.com status.hellosign.com
frame.io status.frame.io|duolingo.com status.duolingo.com|epicgames.com status.epicgames.com|bigcommerce.com status.bigcommerce.com
lambdalabs.com status.lambdalabs.com|shipstation.com status.shipstation.com|scaleway.com status.scaleway.com|mattermost.com status.mattermost.com
element.io status.element.io|twitch.tv status.twitch.com|coursera.org status.coursera.org|instructure.com status.instructure.com
udemy.com status.udemy.com|monzo.com monzo.statuspage.io|onfido.com status.onfido.com|sumsub.com status.sumsub.com
klarna.com status.klarna.com|fullstory.com status.fullstory.com|hotjar.com status.hotjar.com|heapanalytics.com status.heap.io
sumologic.com status.sumologic.com|bitpanda.com status.bitpanda.com|imgix.com status.imgix.com|sinch.com status.sinch.com
braze.com status.braze.com|infobip.com status.infobip.com|sparkpost.com status.sparkpost.com|sumup.com status.sumup.com
iterable.com status.iterable.com|logrocket.com status.logrocket.com|bandwidth.com status.bandwidth.com|mailjet.com status.mailjet.com
personio.de status.personio.de|crates.io status.crates.io|pingidentity.com status.pingidentity.com|crypto.com status.crypto.com
rubygems.org status.rubygems.org|blockchain.com status.blockchain.com|prisma.io www.prisma-status.com|twingate.com status.twingate.com
opensea.io status.opensea.io|etoro.com status.etoro.com|wiz.io status.wiz.io|livekit.io status.livekit.io
quay.io status.quay.io|vanta.com status.vanta.com|drata.com status.drata.com|globalsign.com status.globalsign.com
digicert.com status.digicert.com|hcaptcha.com status.hcaptcha.com|bugsnag.com status.bugsnag.com|proton.me status.proton.me
keepersecurity.com statuspage.keeper.io|yubico.com status.yubico.com`;

export const STATUS_PAGES: Record<string, string> = Object.fromEntries(
  RAW.split(/[|\n]/).map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/) as [string, string]),
);

/** Monitored hosts whose registrable domain differs from the org whose status page covers them. */
export const ORG_ALIASES: Record<string, string> = {
  "githubusercontent.com": "github.com", "ghcr.io": "github.com", "docker.io": "docker.com",
  "trello.com": "trello.com", "heap.io": "heapanalytics.com", "hashicorp.com": "terraform.io",
};

export function statusOrg(registrable: string): string | null {
  const org = ORG_ALIASES[registrable] ?? registrable;
  return STATUS_PAGES[org] ? org : null;
}

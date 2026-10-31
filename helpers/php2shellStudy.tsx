/**
 * Frozen snapshot for the case study "PHP2Shell: who went offline on 21 October 2026" (pure data, client-safe).
 * Source: ShadowGraph radar (5-minute HTTPS checks from AWS us-east-1), table radar_episodes, outages of 30 minutes or more
 * (6+ consecutive failed checks) that started on 21 Oct 2026 UTC. Technology fingerprint taken 22 Oct 2026 ~07:50 UTC
 * from each site's public homepage (generator tags, wp-content paths, PHPSESSID cookie, X-Powered-By header).
 * Numbers are frozen so the study stays reproducible; they do not update.
 */
export const STUDY = {
  id: "php2shell-2026-10",
  disclosed: "2026-10-21",
  snapshotAt: "2026-10-22T07:50:00Z",
  monitored: 3207,
  cves: ["CVE-2026-109618", "CVE-2026-109619"],
};

/** Outages of 30+ minutes started per UTC hour on 21 Oct, and the average of the seven days before (14–20 Oct). */
export const HOURLY: Array<{ h: number; day: number; base: number }> = [
  [0, 1, 6.3], [1, 1, 6.3], [2, 2, 6], [3, 0, 5.1], [4, 1, 5.7], [5, 2, 4.9], [6, 1, 5.7], [7, 6, 5.9], [8, 4, 5.7], [9, 7, 5.7],
  [10, 18, 6], [11, 17, 5.9], [12, 13, 6.3], [13, 33, 5.7], [14, 26, 5.9], [15, 9, 5.3], [16, 7, 5.4], [17, 5, 4.4], [18, 5, 4.7],
  [19, 4, 4.3], [20, 3, 4.4], [21, 1, 5.7], [22, 5, 5.6], [23, 2, 5],
].map(([h, day, base]) => ({ h, day, base }));

/** Outages started per day: 30+ minutes and 2+ hours. */
export const DAILY: Array<{ d: string; long: number; over2h: number }> = [
  { d: "2026-10-14", long: 138, over2h: 69 }, { d: "2026-10-15", long: 118, over2h: 45 }, { d: "2026-10-16", long: 118, over2h: 48 },
  { d: "2026-10-17", long: 162, over2h: 93 }, { d: "2026-10-18", long: 185, over2h: 118 }, { d: "2026-10-19", long: 132, over2h: 73 },
  { d: "2026-10-20", long: 70, over2h: 33 }, { d: "2026-10-21", long: 173, over2h: 98 },
];

/** Network-level incidents the radar opened on its own on 21 Oct: several independent sites in one network failing together. */
export const NETWORK_INCIDENTS: Array<{ network: string; kind: string; start: string; end: string | null; affected: number; atRisk: number }> = [
  { network: "SURF", kind: "Dutch research and education network", start: "2026-10-21T10:47Z", end: "2026-10-22T07:46Z", affected: 3, atRisk: 8 },
  { network: "DFN", kind: "German research network", start: "2026-10-21T13:16Z", end: "2026-10-21T17:36Z", affected: 8, atRisk: 21 },
  { network: "Belnet", kind: "Belgian research and government network", start: "2026-10-21T14:11Z", end: "2026-10-22T00:11Z", affected: 3, atRisk: 2 },
  { network: "SWITCH", kind: "Swiss research network", start: "2026-10-21T14:32Z", end: "2026-10-21T15:22Z", affected: 3, atRisk: 5 },
  { network: "mittwald", kind: "German PHP-focused web hoster", start: "2026-10-21T14:32Z", end: "2026-10-21T20:46Z", affected: 3, atRisk: 0 },
  { network: "OVHcloud", kind: "European cloud and web hoster (3 short incidents)", start: "2026-10-21T14:46Z", end: "2026-10-21T16:31Z", affected: 7, atRisk: 31 },
  { network: "GARR", kind: "Italian research network", start: "2026-10-21T19:16Z", end: "2026-10-21T19:21Z", affected: 3, atRisk: 5 },
];

export type Cms = "TYPO3" | "WordPress" | "Drupal" | "Joomla" | "Magento" | "PHP (session cookie)" | "PHP (header)" | "no PHP signal" | "unreachable";

/** Technology fingerprint: affected sites (outage on 21 Oct) vs a comparison group of 140 sites from the same catalogue lists without an outage. */
export const FINGERPRINT = {
  affected: { sites: 132, reachable: 106, php: 56, by: { TYPO3: 17, WordPress: 19, Drupal: 14, Joomla: 1, Magento: 0, "PHP (session cookie)": 4, "PHP (header)": 1 } },
  comparison: { sites: 140, reachable: 133, php: 35, by: { TYPO3: 2, WordPress: 24, Drupal: 4, Joomla: 1, Magento: 1, "PHP (session cookie)": 2, "PHP (header)": 1 } },
  ci: { affected: [43.4, 62.1], comparison: [19.6, 34.4] },
  oddsRatio: 3.14,
  pFisherOneSided: 2.4e-5,
};

/** Every site with an outage of 30+ minutes that started on 21 Oct (UTC): domain, list, start, recovery, minutes, reason, fingerprint. */
export const ROWS: Array<[string, string, string, string | null, number, string, Cms]> = [
  ["api.bitbucket.org", "Developer platforms", "2026-10-21T17:07", "2026-10-21T17:41", 35, "HTTP 503", "no PHP signal"],
  ["archive.org", "Media & news", "2026-10-21T14:11", "2026-10-21T16:36", 145, "timeout", "no PHP signal"],
  ["bank99.at", "Fintech", "2026-10-21T18:41", null, 750, "timeout", "unreachable"],
  ["monzo.com", "Fintech", "2026-10-21T16:16", "2026-10-21T17:26", 70, "HTTP 500", "no PHP signal"],
  ["adg.de", "Europe", "2026-10-21T14:36", "2026-10-21T15:12", 35, "timeout", "TYPO3"],
  ["agenturserver.de", "Europe", "2026-10-21T14:26", "2026-10-21T20:46", 380, "timeout", "no PHP signal"],
  ["aktuality.sk", "Europe", "2026-10-21T16:42", "2026-10-21T20:46", 245, "timeout", "no PHP signal"],
  ["altibox.no", "Europe", "2026-10-21T14:46", null, 985, "fetch failed", "unreachable"],
  ["antagus.de", "Europe", "2026-10-21T13:41", "2026-10-21T15:22", 100, "fetch failed", "PHP (session cookie)"],
  ["archives-ouvertes.fr", "Europe", "2026-10-21T00:52", "2026-10-21T09:07", 495, "timeout", "unreachable"],
  ["arstechnica.com", "global", "2026-10-21T13:51", "2026-10-21T14:56", 65, "HTTP 503", "WordPress"],
  ["autoriteitpersoonsgegevens.nl", "Europe", "2026-10-21T10:07", null, 1265, "fetch failed", "unreachable"],
  ["belgium.be", "Europe", "2026-10-21T14:06", "2026-10-22T00:11", 605, "HTTP 503", "Drupal"],
  ["blesk.cz", "Europe", "2026-10-21T16:42", "2026-10-21T20:46", 245, "timeout", "PHP (session cookie)"],
  ["bloggersdelight.dk", "Europe", "2026-10-21T15:52", "2026-10-22T01:41", 590, "HTTP 502", "WordPress"],
  ["brandenburg.de", "Europe", "2026-10-21T16:12", "2026-10-22T06:56", 885, "HTTP 503", "WordPress"],
  ["bundesumweltministerium.de", "Europe", "2026-10-21T10:32", "2026-10-21T17:52", 440, "HTTP 503", "TYPO3"],
  ["challenges.fr", "Europe", "2026-10-21T11:22", "2026-10-21T19:16", 475, "HTTP 503", "no PHP signal"],
  ["charite.de", "Europe", "2026-10-21T08:12", "2026-10-21T19:06", 655, "timeout", "TYPO3"],
  ["cnil.fr", "global", "2026-10-21T10:12", null, 1260, "HTTP 503", "unreachable"],
  ["cnr.it", "Europe", "2026-10-21T15:22", "2026-10-21T18:17", 175, "fetch failed", "Drupal"],
  ["daad.de", "Europe", "2026-10-21T13:56", "2026-10-21T17:12", 195, "HTTP 503", "no PHP signal"],
  ["denic.de", "Europe", "2026-10-21T12:47", null, 1105, "fetch failed", "unreachable"],
  ["deviantart.com", "global", "2026-10-21T05:51", "2026-10-21T16:21", 630, "HTTP 503", "no PHP signal"],
  ["digitaltrends.com", "global", "2026-10-21T13:07", "2026-10-21T17:41", 275, "fetch failed", "no PHP signal"],
  ["dlsite.com", "global", "2026-10-21T08:26", "2026-10-21T09:11", 45, "timeout", "no PHP signal"],
  ["domainers.de", "Europe", "2026-10-21T13:56", "2026-10-21T15:22", 85, "timeout", "WordPress"],
  ["ecnavi.jp", "global", "2026-10-21T11:16", "2026-10-22T03:12", 955, "HTTP 503", "no PHP signal"],
  ["elte.hu", "Europe", "2026-10-21T15:12", "2026-10-21T16:26", 75, "timeout", "Drupal"],
  ["epfl.ch", "Europe", "2026-10-21T13:41", null, 1050, "fetch failed", "unreachable"],
  ["eur.nl", "Europe", "2026-10-21T11:31", null, 1180, "timeout", "Drupal"],
  ["europa.eu", "global", "2026-10-21T06:41", "2026-10-21T08:17", 95, "timeout", "Drupal"],
  ["fes.de", "Europe", "2026-10-21T13:56", "2026-10-21T16:57", 180, "fetch failed", "TYPO3"],
  ["fgov.be", "Europe", "2026-10-21T14:06", "2026-10-22T00:11", 605, "HTTP 503", "Drupal"],
  ["finna.fi", "Europe", "2026-10-21T11:06", "2026-10-21T14:41", 215, "HTTP 503", "PHP (session cookie)"],
  ["flexwebhosting.nl", "Europe", "2026-10-21T12:52", null, 1100, "timeout", "unreachable"],
  ["foodsharing.de", "Europe", "2026-10-21T11:16", "2026-10-21T14:06", 170, "HTTP 503", "no PHP signal"],
  ["freifunk-stuttgart.de", "Europe", "2026-10-21T13:22", "2026-10-21T15:56", 155, "HTTP 502", "WordPress"],
  ["gamewith.jp", "global", "2026-10-21T13:01", "2026-10-21T21:06", 485, "HTTP 500", "no PHP signal"],
  ["gdpr-info.eu", "Europe", "2026-10-21T13:41", "2026-10-21T16:57", 195, "timeout", "WordPress"],
  ["govalue.de", "Europe", "2026-10-21T14:26", "2026-10-21T20:46", 380, "timeout", "WordPress"],
  ["grnet.gr", "Europe", "2026-10-21T13:51", null, 1040, "fetch failed", "unreachable"],
  ["hsqd.nl", "Europe", "2026-10-21T10:41", "2026-10-21T14:31", 230, "timeout", "no PHP signal"],
  ["hu-berlin.de", "Europe", "2026-10-21T13:31", "2026-10-21T14:52", 80, "timeout", "no PHP signal"],
  ["ideal.nl", "Europe", "2026-10-21T12:32", "2026-10-21T17:41", 310, "HTTP 500", "no PHP signal"],
  ["inra.fr", "Europe", "2026-10-21T15:26", "2026-10-21T16:36", 70, "timeout", "Drupal"],
  ["inrae.fr", "Europe", "2026-10-21T15:31", "2026-10-21T16:36", 65, "timeout", "Drupal"],
  ["joomla.org", "global", "2026-10-21T12:17", "2026-10-21T23:21", 665, "HTTP 521", "Joomla"],
  ["jouwweb.nl", "Europe", "2026-10-21T13:16", "2026-10-21T16:36", 200, "HTTP 503", "no PHP signal"],
  ["justpaste.it", "Europe", "2026-10-21T14:02", "2026-10-21T18:46", 285, "HTTP 502", "no PHP signal"],
  ["kasserver.com", "global", "2026-10-21T14:11", "2026-10-21T16:16", 125, "timeout", "no PHP signal"],
  ["kdns.fr", "Europe", "2026-10-21T20:06", "2026-10-21T20:52", 45, "timeout", "PHP (header)"],
  ["ki.se", "Europe", "2026-10-21T07:22", "2026-10-21T17:56", 635, "HTTP 503", "Drupal"],
  ["kqbd.mobi", "global", "2026-10-21T09:07", "2026-10-21T11:26", 140, "HTTP 525", "no PHP signal"],
  ["krakow.pl", "Europe", "2026-10-21T12:11", null, 1140, "timeout", "unreachable"],
  ["kurnik.pl", "Europe", "2026-10-21T14:06", "2026-10-21T15:42", 95, "fetch failed", "no PHP signal"],
  ["laracasts.com", "global", "2026-10-21T13:37", "2026-10-21T19:21", 345, "HTTP 521", "WordPress"],
  ["leidenuniv.nl", "Europe", "2026-10-21T09:16", null, 1315, "timeout", "unreachable"],
  ["mamastar.jp", "global", "2026-10-21T10:51", "2026-10-22T00:51", 840, "HTTP 503", "WordPress"],
  ["mediatek.com", "global", "2026-10-21T14:02", "2026-10-21T14:31", 30, "timeout", "no PHP signal"],
  ["meteofrance.com", "global", "2026-10-21T14:22", "2026-10-21T16:42", 140, "timeout", "Drupal"],
  ["mikrotik.com", "global", "2026-10-21T09:11", "2026-10-21T18:27", 555, "HTTP 503", "no PHP signal"],
  ["musicdel.ir", "global", "2026-10-21T07:42", "2026-10-21T08:12", 30, "timeout", "WordPress"],
  ["myanimelist.net", "global", "2026-10-21T13:46", "2026-10-21T18:02", 255, "HTTP 503", "no PHP signal"],
  ["nativendo.de", "Europe", "2026-10-21T16:12", "2026-10-22T05:32", 800, "timeout", "WordPress"],
  ["neostrada.nl", "Europe", "2026-10-21T11:31", null, 1180, "timeout", "unreachable"],
  ["nesine.com", "global", "2026-10-21T18:21", "2026-10-22T04:46", 625, "timeout", "no PHP signal"],
  ["netkeiba.com", "global", "2026-10-21T13:51", "2026-10-21T17:22", 210, "HTTP 503", "no PHP signal"],
  ["nextcloud.com", "global", "2026-10-21T10:47", "2026-10-21T12:47", 120, "HTTP 503", "WordPress"],
  ["nexx360.io", "global", "2026-10-21T20:06", "2026-10-21T20:52", 45, "timeout", "WordPress"],
  ["nicovideo.jp", "global", "2026-10-21T11:31", "2026-10-22T05:26", 1075, "HTTP 503", "no PHP signal"],
  ["nova-app.eu", "Europe", "2026-10-21T13:22", "2026-10-21T18:46", 325, "timeout", "no PHP signal"],
  ["overheid.nl", "Europe", "2026-10-21T09:51", "2026-10-21T11:16", 85, "timeout", "Drupal"],
  ["page-stats.de", "Europe", "2026-10-21T13:01", "2026-10-21T16:21", 200, "fetch failed", "WordPress"],
  ["plusline.de", "Europe", "2026-10-21T10:47", "2026-10-21T17:46", 420, "HTTP 503", "WordPress"],
  ["polsatnews.pl", "Europe", "2026-10-21T02:16", "2026-10-21T02:52", 35, "fetch failed", "no PHP signal"],
  ["rivm.nl", "Europe", "2026-10-21T10:56", null, 1215, "fetch failed", "unreachable"],
  ["rki.de", "Europe", "2026-10-21T10:22", "2026-10-21T14:02", 220, "timeout", "no PHP signal"],
  ["ru.nl", "Europe", "2026-10-21T10:41", "2026-10-21T11:56", 75, "fetch failed", "Drupal"],
  ["ruhr-uni-bochum.de", "Europe", "2026-10-21T10:32", "2026-10-21T13:16", 165, "timeout", "WordPress"],
  ["sedo.com", "global", "2026-10-21T22:01", "2026-10-21T22:52", 50, "HTTP 503", "TYPO3"],
  ["sinoptik.ua", "global", "2026-10-21T05:56", "2026-10-21T06:52", 55, "timeout", "no PHP signal"],
  ["smilewanted.com", "global", "2026-10-21T14:36", "2026-10-21T15:07", 30, "HTTP 502", "WordPress"],
  ["ssl.com", "global", "2026-10-21T13:56", "2026-10-21T14:36", 40, "HTTP 502", "WordPress"],
  ["suumo.jp", "global", "2026-10-21T14:06", null, 1025, "HTTP 503", "unreachable"],
  ["thejournal.ie", "Europe", "2026-10-21T13:41", "2026-10-21T14:11", 30, "fetch failed", "no PHP signal"],
  ["threema.ch", "global", "2026-10-21T14:06", "2026-10-21T17:52", 225, "HTTP 503", "no PHP signal"],
  ["toom.de", "Europe", "2026-10-21T17:12", "2026-10-21T17:56", 45, "HTTP 503", "TYPO3"],
  ["tophost.ch", "Europe", "2026-10-21T14:52", "2026-10-21T23:41", 530, "timeout", "no PHP signal"],
  ["tu-bs.de", "Europe", "2026-10-21T13:07", "2026-10-21T17:07", 240, "timeout", "TYPO3"],
  ["tu-chemnitz.de", "Europe", "2026-10-21T13:37", null, 1055, "timeout", "unreachable"],
  ["tu-dortmund.de", "Europe", "2026-10-21T09:46", "2026-10-22T02:21", 995, "HTTP 503", "TYPO3"],
  ["tu-dresden.de", "Europe", "2026-10-21T13:51", "2026-10-21T14:22", 30, "timeout", "no PHP signal"],
  ["tudelft.nl", "Europe", "2026-10-21T11:31", "2026-10-22T06:51", 1160, "timeout", "TYPO3"],
  ["tue.nl", "Europe", "2026-10-21T09:56", "2026-10-22T02:26", 990, "timeout", "TYPO3"],
  ["tuwien.ac.at", "Europe", "2026-10-21T14:22", "2026-10-21T16:42", 140, "HTTP 503", "TYPO3"],
  ["tvgids.nl", "Europe", "2026-10-21T10:47", "2026-10-21T15:02", 255, "HTTP 503", "PHP (session cookie)"],
  ["tvp.pl", "Europe", "2026-10-21T08:46", "2026-10-21T09:56", 70, "fetch failed", "no PHP signal"],
  ["txnhh.com", "global", "2026-10-21T13:51", "2026-10-21T14:41", 50, "HTTP 503", "no PHP signal"],
  ["u-bordeaux.fr", "Europe", "2026-10-21T16:12", null, 900, "timeout", "unreachable"],
  ["uclouvain.be", "Europe", "2026-10-21T14:31", "2026-10-21T15:26", 55, "HTTP 500", "Drupal"],
  ["ugent.be", "Europe", "2026-10-21T13:41", null, 1050, "timeout", "unreachable"],
  ["um.es", "Europe", "2026-10-21T18:56", "2026-10-22T06:37", 700, "HTTP 502", "no PHP signal"],
  ["uni-bayreuth.de", "Europe", "2026-10-21T11:16", "2026-10-22T05:32", 1095, "timeout", "no PHP signal"],
  ["uni-due.de", "Europe", "2026-10-21T12:07", null, 1145, "timeout", "unreachable"],
  ["uni-halle.de", "Europe", "2026-10-21T12:07", "2026-10-21T16:21", 255, "timeout", "no PHP signal"],
  ["uni-heidelberg.de", "Europe", "2026-10-21T10:26", "2026-10-21T12:32", 125, "fetch failed", "no PHP signal"],
  ["uni-jena.de", "Europe", "2026-10-21T13:31", "2026-10-21T15:17", 105, "fetch failed", "no PHP signal"],
  ["uni-muenster.de", "Europe", "2026-10-21T13:11", "2026-10-22T05:21", 970, "timeout", "unreachable"],
  ["uni-osnabrueck.de", "Europe", "2026-10-21T14:02", "2026-10-21T16:42", 160, "timeout", "TYPO3"],
  ["uni-paderborn.de", "Europe", "2026-10-21T11:22", "2026-10-21T12:07", 45, "fetch failed", "TYPO3"],
  ["uni-tuebingen.de", "Europe", "2026-10-21T11:31", "2026-10-21T17:12", 340, "timeout", "TYPO3"],
  ["uni-wuerzburg.de", "Europe", "2026-10-21T11:56", "2026-10-21T17:36", 340, "timeout", "TYPO3"],
  ["unibas.ch", "Europe", "2026-10-21T14:26", "2026-10-21T15:22", 55, "timeout", "unreachable"],
  ["unicaen.fr", "Europe", "2026-10-21T11:06", "2026-10-21T15:31", 265, "timeout", "WordPress"],
  ["unige.ch", "Europe", "2026-10-21T13:51", null, 1040, "HTTP 503", "unreachable"],
  ["unipd.it", "Europe", "2026-10-21T14:17", null, 1015, "timeout", "unreachable"],
  ["univie.ac.at", "global", "2026-10-21T07:42", "2026-10-21T08:41", 60, "HTTP 501", "TYPO3"],
  ["versatel.de", "Europe", "2026-10-21T14:11", "2026-10-21T20:52", 400, "fetch failed", "Drupal"],
  ["vgwort.de", "Europe", "2026-10-21T14:26", "2026-10-21T20:46", 380, "timeout", "no PHP signal"],
  ["vie-publique.fr", "Europe", "2026-10-21T12:32", "2026-10-22T04:46", 975, "HTTP 503", "no PHP signal"],
  ["vkusvill.ru", "global", "2026-10-21T22:57", "2026-10-22T00:57", 120, "timeout", "unreachable"],
  ["wykop.pl", "Europe", "2026-10-21T12:57", "2026-10-21T18:36", 340, "HTTP 503", "no PHP signal"],
  ["www.caixabank.es", "Europe", "2026-10-21T01:47", "2026-10-21T02:16", 30, "HTTP 530", "no PHP signal"],
  ["www.gog.com", "Gaming", "2026-10-21T15:07", "2026-10-21T18:51", 225, "HTTP 503", "no PHP signal"],
  ["www.golem.de", "DACH", "2026-10-21T15:26", "2026-10-21T21:41", 375, "HTTP 503", "no PHP signal"],
  ["www.hyponoe.at", "Fintech", "2026-10-21T12:26", "2026-10-21T18:21", 355, "HTTP 503", "TYPO3"],
  ["www.hypovbg.at", "Fintech", "2026-10-21T18:41", null, 750, "timeout", "unreachable"],
  ["www.vodafone.com.tr", "Türkiye", "2026-10-21T13:51", "2026-10-21T14:41", 50, "fetch failed", "no PHP signal"],
];

/**
 * Adult sites were removed from the radar catalogue on 23 Oct 2026 and are not listed by name. They stay in every count on
 * the page so the frozen figures remain unchanged: 3 sites, 2 of them still unreachable at the fingerprint.
 */
export const UNLISTED = { count: 3, unreachable: 2 };
export const ANALYSED = ROWS.length + UNLISTED.count;
export const STILL_DOWN = ROWS.filter((r) => r[6] === "unreachable").length + UNLISTED.unreachable;

/** Named examples for the page: universities, research institutes and public bodies (the cluster the network incidents point to). */
const PUBLIC_SECTOR = /(^|\.)(uni-|tu-|tudelft|tue\.nl|eur\.nl|ru\.nl|leidenuniv|ugent|uclouvain|epfl|unige|unibas|unipd|u-bordeaux|unicaen|um\.es|elte|ki\.se|charite|univie|tuwien|hu-berlin|ruhr-uni|daad|fes\.de|cnr\.it|inra|inrae|rki\.de|rivm|cnil|europa\.eu|overheid|belgium\.be|fgov\.be|vie-publique|bundesumweltministerium|brandenburg|autoriteitpersoonsgegevens|meteofrance|grnet|archives-ouvertes|finna\.fi|krakow\.pl|denic)/;
export const publicSector = ROWS.filter((r) => PUBLIC_SECTOR.test(r[0]));

export const toCsv = () =>
  ["domain,catalogue_list,outage_start_utc,recovered_utc,minutes,reason,fingerprint_2026-10-22",
    ...ROWS.map((r) => [r[0], r[1], r[2], r[3] ?? "", r[4], r[5], r[6]].map((x) => (/[",]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(","))].join("\n");

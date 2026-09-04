// gpt6astra.watch — cosmic map app
import { geoNaturalEarth1, geoPath, geoCentroid, geoGraticule10 } from "./assets/vendor/d3-geo.esm.js";
import { feature } from "./assets/vendor/topojson-client.esm.js";

/* ---------------------------------------------------------------- data */

// ISO 3166-1 numeric → alpha-2 (Natural Earth ids)
const NUM_TO_ISO = {
  "004":"AF","008":"AL","010":"AQ","012":"DZ","016":"AS","020":"AD","024":"AO","028":"AG","031":"AZ",
  "032":"AR","036":"AU","040":"AT","044":"BS","048":"BH","050":"BD","051":"AM","052":"BB","056":"BE",
  "060":"BM","064":"BT","068":"BO","070":"BA","072":"BW","076":"BR","084":"BZ","090":"SB","092":"VG",
  "096":"BN","100":"BG","104":"MM","108":"BI","112":"BY","116":"KH","120":"CM","124":"CA","132":"CV",
  "136":"KY","140":"CF","144":"LK","148":"TD","152":"CL","156":"CN","158":"TW","162":"CX","166":"CC",
  "170":"CO","174":"KM","175":"YT","178":"CG","180":"CD","184":"CK","188":"CR","191":"HR","192":"CU",
  "196":"CY","203":"CZ","204":"BJ","208":"DK","212":"DM","214":"DO","218":"EC","222":"SV","226":"GQ",
  "231":"ET","232":"ER","233":"EE","238":"FK","239":"GS","242":"FJ","246":"FI","250":"FR","254":"GF",
  "258":"PF","260":"TF","262":"DJ","266":"GA","268":"GE","270":"GM","275":"PS","276":"DE","288":"GH",
  "292":"GI","296":"KI","300":"GR","304":"GL","308":"GD","312":"GP","316":"GU","320":"GT","324":"GN",
  "328":"GY","332":"HT","334":"HM","336":"VA","340":"HN","344":"HK","348":"HU","352":"IS","356":"IN",
  "360":"ID","364":"IR","368":"IQ","372":"IE","376":"IL","380":"IT","384":"CI","388":"JM","392":"JP",
  "398":"KZ","400":"JO","404":"KE","408":"KP","410":"KR","414":"KW","417":"KG","418":"LA","422":"LB",
  "426":"LS","428":"LV","430":"LR","434":"LY","438":"LI","440":"LT","442":"LU","446":"MO","450":"MG",
  "454":"MW","458":"MY","462":"MV","466":"ML","470":"MT","474":"MQ","478":"MR","480":"MU","484":"MX",
  "492":"MC","496":"MN","498":"MD","499":"ME","500":"MS","504":"MA","508":"MZ","512":"OM","516":"NA",
  "520":"NR","524":"NP","528":"NL","530":"CW","531":"BQ","533":"AW","534":"SX","540":"NC","548":"VU",
  "554":"NZ","558":"NI","562":"NE","566":"NG","570":"NU","574":"NF","578":"NO","580":"MP","583":"FM",
  "584":"MH","585":"PW","586":"PK","591":"PA","598":"PG","608":"PH","616":"PL","620":"PT","624":"GW",
  "626":"TL","630":"PR","634":"QA","642":"RO","643":"RU","646":"RW","654":"SH","659":"KN","662":"LC",
  "670":"VC","674":"SM","678":"ST","682":"SA","686":"SN","688":"RS","690":"SC","694":"SL","702":"SG",
  "703":"SK","704":"VN","705":"SI","706":"SO","710":"ZA","716":"ZM","724":"ES","728":"SS","729":"SD",
  "732":"EH","740":"SR","744":"SJ","748":"SZ","752":"SE","756":"CH","760":"SY","762":"TJ","764":"TH",
  "768":"TG","776":"TO","780":"TT","784":"AE","788":"TN","792":"TR","795":"TM","796":"TC","798":"TV",
  "800":"UG","804":"UA","807":"MK","818":"EG","826":"GB","834":"TZ","840":"US","850":"VI","854":"BF",
  "858":"UY","860":"UZ","862":"VE","876":"WF","882":"WS","887":"YE","894":"ZW",
};

// world-atlas uses -99 for some disputed areas; map by name where we care.
const NAME_TO_ISO = { "Kosovo": "XK" };

// Nicer display names for abbreviated Natural Earth labels.
const NAME_FIXES = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "DR Congo",
  "Dominican Rep.": "Dominican Republic",
  "Falkland Is.": "Falkland Islands",
  "Fr. S. Antarctic Lands": "French Southern Lands",
  "Central African Rep.": "Central African Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  "N. Cyprus": "Northern Cyprus",
  "Czechia": "Czechia",
  "Somaliland": "Somaliland",
  "W. Sahara": "Western Sahara",
  "Timor-Leste": "Timor-Leste",
  "eSwatini": "Eswatini",
};

// IANA timezone → ISO alpha-2 (common zones; detection is a convenience, the
// map click is the explicit source of truth).
const TZ_TO_COUNTRY = {
  "Europe/Amsterdam":"NL","Europe/Andorra":"AD","Europe/Athens":"GR","Europe/Belgrade":"RS",
  "Europe/Berlin":"DE","Europe/Bratislava":"SK","Europe/Brussels":"BE","Europe/Bucharest":"RO",
  "Europe/Budapest":"HU","Europe/Busingen":"DE","Europe/Chisinau":"MD","Europe/Copenhagen":"DK",
  "Europe/Dublin":"IE","Europe/Gibraltar":"GI","Europe/Guernsey":"GG","Europe/Helsinki":"FI",
  "Europe/Isle_of_Man":"IM","Europe/Istanbul":"TR","Europe/Jersey":"JE","Europe/Kaliningrad":"RU",
  "Europe/Kyiv":"UA","Europe/Kiev":"UA","Europe/Lisbon":"PT","Europe/Ljubljana":"SI",
  "Europe/London":"GB","Europe/Luxembourg":"LU","Europe/Madrid":"ES","Europe/Malta":"MT",
  "Europe/Mariehamn":"FI","Europe/Minsk":"BY","Europe/Monaco":"MC","Europe/Moscow":"RU",
  "Europe/Oslo":"NO","Europe/Paris":"FR","Europe/Podgorica":"ME","Europe/Prague":"CZ",
  "Europe/Riga":"LV","Europe/Rome":"IT","Europe/Samara":"RU","Europe/San_Marino":"SM",
  "Europe/Sarajevo":"BA","Europe/Saratov":"RU","Europe/Simferopol":"UA","Europe/Skopje":"MK",
  "Europe/Sofia":"BG","Europe/Stockholm":"SE","Europe/Tallinn":"EE","Europe/Tirane":"AL",
  "Europe/Ulyanovsk":"RU","Europe/Uzhgorod":"UA","Europe/Vaduz":"LI","Europe/Vatican":"VA",
  "Europe/Vienna":"AT","Europe/Vilnius":"LT","Europe/Volgograd":"RU","Europe/Warsaw":"PL",
  "Europe/Zagreb":"HR","Europe/Zurich":"CH",
  "America/Anchorage":"US","America/Anguilla":"AI","America/Antigua":"AG","America/Araguaina":"BR",
  "America/Asuncion":"PY","America/Bahamas":"BS","America/Barbados":"BB","America/Belize":"BZ",
  "America/Blanc-Sablon":"CA","America/Boa_Vista":"BR","America/Bogota":"CO","America/Boise":"US",
  "America/Cambridge_Bay":"CA","America/Campo_Grande":"BR","America/Cancun":"MX","America/Caracas":"VE",
  "America/Cayman":"KY","America/Chicago":"US","America/Chihuahua":"MX","America/Costa_Rica":"CR",
  "America/Creston":"CA","America/Cuiaba":"BR","America/Curacao":"CW","America/Danmarkshavn":"GL",
  "America/Dawson":"CA","America/Dawson_Creek":"CA","America/Denver":"US","America/Detroit":"US",
  "America/Dominica":"DM","America/Edmonton":"CA","America/Eirunepe":"BR","America/El_Salvador":"SV",
  "America/Fort_Nelson":"CA","America/Fortaleza":"BR","America/Glace_Bay":"CA","America/Goose_Bay":"CA",
  "America/Grand_Turk":"TC","America/Grenada":"GD","America/Guadeloupe":"GP","America/Guatemala":"GT",
  "America/Guayaquil":"EC","America/Guyana":"GY","America/Halifax":"CA","America/Havana":"CU",
  "America/Hermosillo":"MX","America/Jamaica":"JM","America/Juneau":"US","America/Kralendijk":"BQ",
  "America/La_Paz":"BO","America/Lima":"PE","America/Los_Angeles":"US","America/Louisville":"US",
  "America/Lower_Princes":"SX","America/Maceio":"BR","America/Managua":"NI","America/Manaus":"BR",
  "America/Marigot":"MF","America/Martinique":"MQ","America/Matamoros":"MX","America/Mazatlan":"MX",
  "America/Menominee":"US","America/Merida":"MX","America/Metlakatla":"US","America/Mexico_City":"MX",
  "America/Miquelon":"PM","America/Moncton":"CA","America/Monterrey":"MX","America/Montevideo":"UY",
  "America/Montserrat":"MS","America/Nassau":"BS","America/New_York":"US","America/Nome":"US",
  "America/Noronha":"BR","America/Nuuk":"GL","America/Ojinaga":"MX","America/Panama":"PA",
  "America/Paramaribo":"SR","America/Phoenix":"US","America/Port-au-Prince":"HT",
  "America/Port_of_Spain":"TT","America/Porto_Velho":"BR","America/Puerto_Rico":"PR",
  "America/Punta_Arenas":"CL","America/Rankin_Inlet":"CA","America/Recife":"BR","America/Regina":"CA",
  "America/Resolute":"CA","America/Rio_Branco":"BR","America/Santarem":"BR","America/Santiago":"CL",
  "America/Santo_Domingo":"DO","America/Sao_Paulo":"BR","America/Scoresbysund":"GL","America/Sitka":"US",
  "America/St_Barthelemy":"BL","America/St_Johns":"CA","America/St_Kitts":"KN","America/St_Lucia":"LC",
  "America/St_Thomas":"VI","America/St_Vincent":"VC","America/Swift_Current":"CA",
  "America/Tegucigalpa":"HN","America/Thule":"GL","America/Tijuana":"MX","America/Toronto":"CA",
  "America/Tortola":"VG","America/Vancouver":"CA","America/Whitehorse":"CA","America/Winnipeg":"CA",
  "America/Yakutat":"US",
  "Asia/Aden":"YE","Asia/Almaty":"KZ","Asia/Amman":"JO","Asia/Anadyr":"RU","Asia/Aqtau":"KZ",
  "Asia/Aqtobe":"KZ","Asia/Ashgabat":"TM","Asia/Atyrau":"KZ","Asia/Baghdad":"IQ","Asia/Bahrain":"BH",
  "Asia/Baku":"AZ","Asia/Bangkok":"TH","Asia/Barnaul":"RU","Asia/Beirut":"LB","Asia/Bishkek":"KG",
  "Asia/Brunei":"BN","Asia/Chita":"RU","Asia/Choibalsan":"MN","Asia/Colombo":"LK","Asia/Damascus":"SY",
  "Asia/Dhaka":"BD","Asia/Dili":"TL","Asia/Dubai":"AE","Asia/Dushanbe":"TJ","Asia/Famagusta":"CY",
  "Asia/Gaza":"PS","Asia/Hebron":"PS","Asia/Ho_Chi_Minh":"VN","Asia/Hong_Kong":"HK","Asia/Hovd":"MN",
  "Asia/Irkutsk":"RU","Asia/Jakarta":"ID","Asia/Jayapura":"ID","Asia/Jerusalem":"IL","Asia/Kabul":"AF",
  "Asia/Kamchatka":"RU","Asia/Karachi":"PK","Asia/Kathmandu":"NP","Asia/Khandyga":"RU","Asia/Kolkata":"IN",
  "Asia/Krasnoyarsk":"RU","Asia/Kuala_Lumpur":"MY","Asia/Kuching":"MY","Asia/Kuwait":"KW","Asia/Macau":"MO",
  "Asia/Magadan":"RU","Asia/Makassar":"ID","Asia/Manila":"PH","Asia/Muscat":"OM","Asia/Nicosia":"CY",
  "Asia/Novokuznetsk":"RU","Asia/Novosibirsk":"RU","Asia/Omsk":"RU","Asia/Oral":"KZ","Asia/Phnom_Penh":"KH",
  "Asia/Pontianak":"ID","Asia/Pyongyang":"KP","Asia/Qatar":"QA","Asia/Qyzylorda":"KZ","Asia/Riyadh":"SA",
  "Asia/Sakhalin":"RU","Asia/Samarkand":"UZ","Asia/Seoul":"KR","Asia/Shanghai":"CN","Asia/Singapore":"SG",
  "Asia/Srednekolymsk":"RU","Asia/Taipei":"TW","Asia/Tashkent":"UZ","Asia/Tbilisi":"GE","Asia/Tehran":"IR",
  "Asia/Thimphu":"BT","Asia/Tokyo":"JP","Asia/Tomsk":"RU","Asia/Ulaanbaatar":"MN","Asia/Urumqi":"CN",
  "Asia/Ust-Nera":"RU","Asia/Vientiane":"LA","Asia/Vladivostok":"RU","Asia/Yakutsk":"RU","Asia/Yangon":"MM",
  "Asia/Yekaterinburg":"RU","Asia/Yerevan":"AM",
  "Africa/Abidjan":"CI","Africa/Accra":"GH","Africa/Addis_Ababa":"ET","Africa/Algiers":"DZ",
  "Africa/Asmara":"ER","Africa/Bamako":"ML","Africa/Bangui":"CF","Africa/Banjul":"GM","Africa/Bissau":"GW",
  "Africa/Blantyre":"MW","Africa/Brazzaville":"CG","Africa/Bujumbura":"BI","Africa/Cairo":"EG",
  "Africa/Casablanca":"MA","Africa/Ceuta":"ES","Africa/Conakry":"GN","Africa/Dakar":"SN",
  "Africa/Dar_es_Salaam":"TZ","Africa/Djibouti":"DJ","Africa/Douala":"CM","Africa/El_Aaiun":"EH",
  "Africa/Freetown":"SL","Africa/Gaborone":"BW","Africa/Harare":"ZW","Africa/Johannesburg":"ZA",
  "Africa/Juba":"SS","Africa/Kampala":"UG","Africa/Khartoum":"SD","Africa/Kigali":"RW","Africa/Kinshasa":"CD",
  "Africa/Lagos":"NG","Africa/Libreville":"GA","Africa/Lome":"TG","Africa/Luanda":"AO",
  "Africa/Lubumbashi":"CD","Africa/Lusaka":"ZM","Africa/Malabo":"GQ","Africa/Maputo":"MZ","Africa/Maseru":"LS",
  "Africa/Mbabane":"SZ","Africa/Mogadishu":"SO","Africa/Monrovia":"LR","Africa/Nairobi":"KE",
  "Africa/Ndjamena":"TD","Africa/Niamey":"NE","Africa/Nouakchott":"MR","Africa/Ouagadougou":"BF",
  "Africa/Porto-Novo":"BJ","Africa/Sao_Tome":"ST","Africa/Tripoli":"LY","Africa/Tunis":"TN",
  "Africa/Windhoek":"NA",
  "Indian/Antananarivo":"MG","Indian/Chagos":"IO","Indian/Christmas":"CX","Indian/Cocos":"CC",
  "Indian/Comoro":"KM","Indian/Kerguelen":"TF","Indian/Mahe":"SC","Indian/Maldives":"MV",
  "Indian/Mauritius":"MU","Indian/Mayotte":"YT","Indian/Reunion":"RE",
  "Australia/Sydney":"AU","Australia/Melbourne":"AU","Australia/Brisbane":"AU","Australia/Perth":"AU",
  "Australia/Adelaide":"AU","Australia/Darwin":"AU","Australia/Hobart":"AU","Australia/Canberra":"AU",
  "Australia/Broken_Hill":"AU","Australia/Currie":"AU","Australia/Lindeman":"AU","Australia/Lord_Howe":"AU",
  "Australia/Macquarie":"AU",
  "Pacific/Auckland":"NZ","Pacific/Fiji":"FJ","Pacific/Funafuti":"TV","Pacific/Galapagos":"EC",
  "Pacific/Gambier":"PF","Pacific/Guadalcanal":"SB","Pacific/Guam":"GU","Pacific/Honiara":"SB",
  "Pacific/Kanton":"KI","Pacific/Kiritimati":"KI","Pacific/Kosrae":"FM","Pacific/Kwajalein":"MH",
  "Pacific/Majuro":"MH","Pacific/Midway":"US","Pacific/Nauru":"NR","Pacific/Noumea":"NC",
  "Pacific/Pago_Pago":"AS","Pacific/Palau":"PW","Pacific/Pitcairn":"PN","Pacific/Pohnpei":"FM",
  "Pacific/Port_Moresby":"PG","Pacific/Rarotonga":"CK","Pacific/Saipan":"MP","Pacific/Tahiti":"PF",
  "Pacific/Tarawa":"KI","Pacific/Tongatapu":"TO","Pacific/Wake":"US","Pacific/Wallis":"WF",
  "Atlantic/Azores":"PT","Atlantic/Bermuda":"BM","Atlantic/Canary":"ES","Atlantic/Cape_Verde":"CV",
  "Atlantic/Faroe":"FO","Atlantic/Madeira":"PT","Atlantic/Reykjavik":"IS","Atlantic/South_Georgia":"GS",
  "Atlantic/St_Helena":"SH","Atlantic/Stanley":"FK",
};

/* ---------------------------------------------------------------- helpers */

const $ = (sel) => document.querySelector(sel);
const svgNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const flagOf = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const relTime = (ts) => {
  if (!ts) return "—";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const detectCountry = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (TZ_TO_COUNTRY[tz]) return TZ_TO_COUNTRY[tz];
    for (const prefix of ["America/Argentina/", "America/Indiana/", "America/Kentucky/", "America/North_Dakota/"]) {
      if (tz.startsWith(prefix)) return { "America/Argentina/": "AR" }[prefix] || "US";
    }
  } catch { /* ignore */ }
  return null;
};

const toast = (msg, ms = 3200) => {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
};

/* ---------------------------------------------------------------- starfield */

const canvas = $("#starfield");
const ctx = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let stars = [];

function seedStars() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.min(420, Math.floor((innerWidth * innerHeight) / 7000));
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: 0.35 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 1.2,
    warm: Math.random() < 0.06,
  }));
}

function drawStars(t) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const s of stars) {
    const alpha = reducedMotion ? 0.7 : 0.25 + 0.75 * Math.abs(Math.sin(t / 1000 * s.speed + s.phase));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.warm ? "#ffd9a0" : "#e6ecff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 6.2832);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function starLoop(t) {
  if (!document.hidden) drawStars(t);
  requestAnimationFrame(starLoop);
}

seedStars();
if (reducedMotion) drawStars(0);
else requestAnimationFrame(starLoop);

/* ---------------------------------------------------------------- state */

const initialCountry = detectCountry();

const state = {
  countries: [],        // [{iso, name, feature, centroid, d}]
  byIso: new Map(),
  summary: { countries: {}, totals: { lit: 0, reported: 0, rumored: 0, reports: 0, monitoring: 0 } },
  selected: null,
  myCountry: initialCountry,
  detectedCountry: initialCountry,
  lastFeedId: 0,
  tickEvents: [],       // [{type:'report'|'lit', cc, name, ts}]
  scriptOnly: localStorage.getItem("astra-script-only") === "1",
  pathGen: null,
  projection: null,
};

/* ---------------------------------------------------------------- map */

const svg = $("#map");
const gGrat = el("g", { id: "g-grat" });
const outline = el("path", { class: "sphere-outline" });
const gCountries = el("g", { id: "g-countries" });
const constellationEl = el("path", { class: "constellation" });
const gStars = el("g", { id: "g-stars" });
const gBursts = el("g", { id: "g-bursts" });
svg.append(gGrat, outline, gCountries, constellationEl, gStars, gBursts);

const STAR_PATH = "M0,-7 C1,-2 2,-1 7,0 C2,1 1,2 0,7 C-1,2 -2,1 -7,0 C-2,-1 -1,-2 0,-7 Z";

function layoutMap() {
  const rect = svg.getBoundingClientRect();
  if (rect.width < 10) return;
  const leftGutter = rect.width > 860 ? Math.min(500, rect.width * 0.38) : 10;
  const projection = geoNaturalEarth1().fitExtent(
    [[leftGutter, 10], [rect.width - 10, rect.height - 10]],
    { type: "Sphere" }
  );
  const pathGen = geoPath(projection);
  state.projection = projection;
  state.pathGen = pathGen;

  gGrat.replaceChildren(el("path", { class: "graticule", d: pathGen(geoGraticule10()) }));
  outline.setAttribute("d", pathGen({ type: "Sphere" }));

  for (const c of state.countries) {
    c.d = pathGen(c.feature);
    c.xy = projection(geoCentroid(c.feature));
    if (c.node) c.node.setAttribute("d", c.d || "");
  }
  renderStars();
  renderConstellation();
}

async function loadWorld() {
  const res = await fetch("/assets/countries-110m.json");
  const world = await res.json();
  const feats = feature(world, world.objects.countries).features;
  state.countries = feats
    .filter((f) => String(f.id) !== "010") // drop Antarctica — cleaner sky
    .map((f) => {
      const name = NAME_FIXES[f.properties.name] || f.properties.name;
      const iso = NUM_TO_ISO[String(f.id).padStart(3, "0")] || NAME_TO_ISO[f.properties.name] || null;
      return { iso, name, feature: f, node: null, xy: null };
    });
  state.byIso = new Map(state.countries.filter((c) => c.iso).map((c) => [c.iso, c]));

  for (const c of state.countries) {
    const node = el("path", { class: "country", d: "" });
    if (c.iso) {
      node.setAttribute("data-iso", c.iso);
      const title = document.createElementNS(svgNS, "title");
      title.textContent = `${c.name}${c.iso ? ` (${c.iso})` : ""}`;
      node.append(title);
      node.addEventListener("click", () => selectCountry(c.iso));
    } else {
      node.classList.add("inert");
    }
    c.node = node;
    gCountries.append(node);
  }
}

async function refineDetectedCountry() {
  try {
    const response = await fetch("/api/location", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.country && state.byIso.has(data.country)) {
      state.detectedCountry = data.country;
      state.myCountry = data.country;
    }
  } catch {
    // Timezone detection remains the offline fallback.
  }
}

function statusFromCountry(data) {
  if (!data) return "none";
  if (!state.scriptOnly) return data.status || "none";
  const watcherReports = data.watcher ?? 0;
  if (watcherReports >= 2) return "live";
  if (watcherReports === 1) return "rumored";
  return "none";
}

function statusOf(iso) {
  return statusFromCountry(state.summary.countries[iso]);
}

function paintCountries() {
  for (const c of state.countries) {
    if (!c.iso || !c.node) continue;
    const data = state.summary.countries[c.iso] || {};
    const status = statusOf(c.iso);
    c.node.classList.remove("rumored", "reported", "live", "self-reported", "script-reported");
    if (status !== "none") {
      c.node.classList.add(status);
    } else {
      c.node.classList.remove("ignite");
    }
    if (status !== "none" && status !== "live" &&
        (data.watcher ?? 0) > 0 && (state.scriptOnly || !(data.web ?? 0))) {
      c.node.classList.add("script-reported");
    } else if (status !== "none" && status !== "live" &&
               (data.web ?? 0) > 0 && !(data.watcher ?? 0)) {
      c.node.classList.add("self-reported");
    }
  }
}

function renderStars() {
  gStars.replaceChildren();
  for (const c of state.countries) {
    if (!c.iso || !c.xy || statusOf(c.iso) !== "live") continue;
    const s = el("path", {
      class: "star-marker",
      d: STAR_PATH,
      transform: `translate(${c.xy[0]},${c.xy[1]}) scale(${starScale(c.iso)})`,
    });
    s.style.animationDelay = `${(c.iso.charCodeAt(0) + c.iso.charCodeAt(1)) % 34 / 10}s`;
    gStars.append(s);
  }
}

function starScale(iso) {
  // bigger stars for rollouts backed by account-access signals
  const c = state.summary.countries[iso];
  if (c?.watcher >= 2) return 1.35;
  if (c?.watcher >= 1) return 1.15;
  return 1;
}

function renderConstellation() {
  const lit = state.countries
    .filter((c) => c.iso && c.xy && statusOf(c.iso) === "live")
    .sort((a, b) => (state.summary.countries[a.iso].first_at || 0) - (state.summary.countries[b.iso].first_at || 0));
  if (lit.length < 2) {
    constellationEl.setAttribute("d", "");
    return;
  }
  constellationEl.setAttribute("d", "M" + lit.map((c) => `${c.xy[0].toFixed(1)},${c.xy[1].toFixed(1)}`).join(" L"));
}

function burstAt(iso) {
  const c = state.byIso.get(iso);
  if (!c?.xy) return;
  const b = el("circle", { class: "burst", cx: c.xy[0], cy: c.xy[1], r: 2 });
  gBursts.append(b);
  setTimeout(() => b.remove(), 1700);
}

function ignite(iso) {
  const c = state.byIso.get(iso);
  if (!c?.node) return;
  c.node.classList.remove("ignite");
  void c.node.getBBox; // reflow to restart animation
  c.node.classList.add("ignite");
  setTimeout(() => c.node?.classList.remove("ignite"), 2500);
}

/* ---------------------------------------------------------------- counters */

const counters = { lit: $("#c-lit"), monitoring: $("#c-monitoring"), reports: $("#c-reports") };
const prevTotals = { lit: null, monitoring: null, reports: null };

function viewTotals() {
  if (!state.scriptOnly) return state.summary.totals;
  let lit = 0;
  let reports = 0;
  for (const country of Object.values(state.summary.countries)) {
    reports += country.watcher ?? 0;
    if ((country.watcher ?? 0) >= 2) lit++;
  }
  return { ...state.summary.totals, lit, reports };
}

function paintCounters() {
  const totals = viewTotals();
  for (const key of ["lit", "monitoring", "reports"]) {
    const node = counters[key];
    const val = totals[key] ?? 0;
    if (prevTotals[key] !== null && prevTotals[key] !== val) {
      node.classList.remove("bump");
      void node.offsetWidth;
      node.classList.add("bump");
    }
    prevTotals[key] = val;
    node.textContent = val.toLocaleString();
  }
  document.title = totals.lit > 0
    ? `(${totals.lit} lit) gpt6astra.watch`
    : "gpt6astra.watch — is it in your sky yet?";
}

/* ---------------------------------------------------------------- panel */

const panel = $("#panel");

function selectCountry(iso) {
  const c = state.byIso.get(iso);
  if (!c) return;
  state.selected = iso;
  for (const node of gCountries.children) node.classList.remove("selected");
  c.node?.classList.add("selected");
  renderPanel();
}

function closePanel() {
  state.selected = null;
  panel.hidden = true;
  for (const node of gCountries.children) node.classList.remove("selected");
}

function statusLabel(data, status = statusFromCountry(data)) {
  if (status === "live") return "✦ Lit";
  if (status === "none") return "Still dark";
  if (state.scriptOnly || ((data.watcher ?? 0) > 0 && !(data.web ?? 0))) {
    return "Script reported";
  }
  if ((data.web ?? 0) > 0 && !(data.watcher ?? 0)) return "Self reported";
  return "Reported";
}

function renderPanel() {
  const iso = state.selected;
  const c = state.byIso.get(iso);
  if (!c || !iso) return;
  const d = state.summary.countries[iso] || {};
  const viewStatus = statusOf(iso);
  const reported = localStorage.getItem(`astra-reported-${iso}`);

  panel.innerHTML = "";
  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.onclick = closePanel;

  const flag = document.createElement("div");
  flag.className = "flag";
  flag.textContent = flagOf(iso);

  const h2 = document.createElement("h2");
  h2.textContent = c.name;

  const statusLine = document.createElement("div");
  statusLine.className = "status-line";
  const chip = document.createElement("span");
  chip.className = `status-chip ${viewStatus}`;
  chip.textContent = statusLabel(d, viewStatus);
  statusLine.append(chip);
  if (viewStatus === "live" && d.first_at && !state.scriptOnly) {
    const since = document.createElement("span");
    since.textContent = `first seen ${relTime(d.first_at)}`;
    statusLine.append(since);
  }

  const stats = document.createElement("div");
  stats.className = "stats";
  const visibleReports = state.scriptOnly ? (d.watcher ?? 0) : (d.reports ?? 0);
  stats.innerHTML = `
    <div><b>${visibleReports.toLocaleString()}</b><span>${state.scriptOnly ? "script reports" : "reports"}</span></div>
    <div><b>${(d.monitoring ?? 0).toLocaleString()}</b><span>monitoring now</span></div>
    <div><b>${d.web ?? 0}</b><span>${state.scriptOnly ? "web reports hidden" : "distinct reporters"}</span></div>
    <div><b>${d.watcher ?? 0}</b><span>account signals</span></div>`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (reported) {
    const thanks = document.createElement("div");
    thanks.className = "thanks";
    thanks.textContent = "You're counted. Welcome to the constellation ✦";
    const undo = document.createElement("button");
    undo.className = "btn btn-ghost";
    undo.type = "button";
    undo.textContent = "Reported by mistake? Undo";
    undo.onclick = () => undoReport(iso, undo);
    actions.append(thanks, undo);
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.type = "button";
    btn.textContent = `✦ I got Astra — light up ${c.name}`;
    btn.onclick = () => submitReport(iso, btn);
    actions.append(btn);
  }

  const watch = document.createElement("a");
  watch.className = "btn btn-ghost";
  watch.href = "/skill";
  watch.textContent = "⌁ Join the Stargazers (get the script)";
  actions.append(watch);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = state.scriptOnly
    ? "Showing only access reports sent by consented skill/script watchers. Manual web reports are hidden."
    : "The map is crowd signal — anyone can light a country. For proof on your own account, use a watcher (it checks the Codex model picker).";

  panel.append(close, flag, h2, statusLine, stats, actions, hint);
  panel.hidden = false;
}

function confirmCountryMismatch(iso) {
  const detectedIso = state.detectedCountry;
  if (!detectedIso || detectedIso === iso) return true;
  const detectedName = state.byIso.get(detectedIso)?.name || detectedIso;
  const reportName = state.byIso.get(iso)?.name || iso;
  const questions = [
    `Tiny telescope check: your current sky looks like ${detectedName}, but you're reporting ${reportName}. Did Astra really land there?`,
    `Constellation double-check: ${reportName}, not ${detectedName} — are you absolutely sure?`,
    `Final launch key: promise this ${reportName} report is real and you'll help keep the community sky honest?`,
  ];
  return questions.every((question) => window.confirm(question));
}

async function submitReport(iso, btn) {
  if (!confirmCountryMismatch(iso)) {
    toast("Launch aborted — no stars were harmed ✦");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Lighting it up…";
  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: iso, nickname: "" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed");
    if (data.deduped) {
      if (data.can_undo) {
        localStorage.setItem(`astra-reported-${iso}`, String(Date.now()));
      } else {
        localStorage.removeItem(`astra-reported-${iso}`);
      }
      toast(data.message || "You already reported this country ✦");
    } else {
      localStorage.setItem(`astra-reported-${iso}`, String(Date.now()));
      burstAt(iso);
      ignite(iso);
      toast("Lit ✦ thanks for reporting");
      await refreshSummary(true);
    }
    renderPanel();
  } catch (err) {
    toast("Could not report — try again in a moment");
    btn.disabled = false;
    btn.textContent = "✦ I got Astra";
  }
}

async function undoReport(iso, btn) {
  btn.disabled = true;
  btn.textContent = "Correcting the sky…";
  try {
    const res = await fetch("/api/report", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: iso }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed");
    localStorage.removeItem(`astra-reported-${iso}`);
    toast(data.removed
      ? "Report removed — thanks for keeping the constellation honest ✦"
      : "That report was already gone.");
    await refreshSummary(true);
  } catch (err) {
    toast("Could not undo from this browser — the private undo key may be missing");
    btn.disabled = false;
    btn.textContent = "Reported by mistake? Undo";
  }
}

svg.addEventListener("click", (e) => {
  if (e.target === svg || e.target.classList?.contains("graticule")) closePanel();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

/* ---------------------------------------------------------------- you chip */

function paintYouChip() {
  const chip = $("#you-chip");
  const select = $("#country-select");
  if (!state.countries.length) return;
  if (!select.options.length) {
    const sorted = [...state.countries].filter((c) => c.iso).sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sorted) {
      const opt = document.createElement("option");
      opt.value = c.iso;
      opt.textContent = `${c.name}`;
      select.append(opt);
    }
    if (state.myCountry) select.value = state.myCountry;
    select.addEventListener("change", () => {
      state.myCountry = select.value;
      selectCountry(select.value);
    });
    $("#you-got").addEventListener("click", () => selectCountry(select.value));
  }
  chip.hidden = false;
  const c = state.byIso.get(state.myCountry) || null;
  $("#you-text").innerHTML = c
    ? `Your sky: <strong>${flagOf(c.iso)} ${c.name}</strong> — ${statusLabel(state.summary.countries[c.iso] || {}, statusOf(c.iso)).toLowerCase()}`
    : `Pick your sky:`;
}

/* ---------------------------------------------------------------- ticker */

function pushTick(event) {
  state.tickEvents.push(event);
  if (state.tickEvents.length > 24) state.tickEvents.shift();
  paintTicker();
}

function paintTicker() {
  const track = $("#ticker-track");
  const visibleEvents = state.scriptOnly
    ? state.tickEvents.filter((event) => event.type === "report" && event.source === "watcher")
    : state.tickEvents;
  const items = visibleEvents.map((e) => {
    if (e.type === "lit") {
      return `<span class="tick lit-event"><span class="t-flag">${flagOf(e.cc)}</span>` +
        `<strong>${e.name}</strong> just lit up ✦ <time>${relTime(e.ts)}</time></span>`;
    }
    return `<span class="tick"><span class="t-flag">${flagOf(e.cc)}</span>` +
      `someone got Astra in <strong>${e.name}</strong>` +
      `${e.source === "watcher" ? " · account signal" : ""} <time>${relTime(e.ts)}</time></span>`;
  });
  if (!items.length) {
    items.push('<span class="tick">waiting for the first reports… be the star that breaks the dark ✦</span>');
  }
  const html = items.join("");
  track.innerHTML = html + html; // duplicated for the seamless marquee loop
}

/* ---------------------------------------------------------------- data sync */

async function refreshSummary(force = false) {
  const res = await fetch("/api/summary", force ? { cache: "no-store" } : undefined);
  if (!res.ok) return;
  const data = await res.json();
  const prev = state.summary;
  state.summary = data;

  // detect newly lit countries while the tab was open
  for (const [iso, d] of Object.entries(data.countries)) {
    const was = statusFromCountry(prev.countries[iso]);
    const next = statusFromCountry(d);
    if (next === "live" && was !== "live") {
      const c = state.byIso.get(iso);
      ignite(iso);
      burstAt(iso);
      if (was !== "none" || prev.countries[iso]) {
        pushTick({ type: "lit", cc: iso, name: c?.name || iso, ts: d.first_at || Date.now() });
      }
    }
  }

  paintCountries();
  renderStars();
  renderConstellation();
  paintCounters();
  if (state.selected) renderPanel();
  paintYouChip();
}

async function refreshFeed() {
  const res = await fetch(`/api/feed?after=${state.lastFeedId}`);
  if (!res.ok) return;
  const data = await res.json();
  const events = [...(data.events || [])].sort((a, b) => a.id - b.id);
  for (const e of events) {
    if (e.id > state.lastFeedId) {
      state.lastFeedId = e.id;
      const c = state.byIso.get(e.country);
      pushTick({ type: "report", cc: e.country, name: c?.name || e.country, ts: e.created_at, source: e.source });
    }
  }
}

/* ---------------------------------------------------------------- boot */

let resizeTimer;
addEventListener("resize", () => {
  seedStars();
  if (reducedMotion) drawStars(0);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layoutMap, 120);
});

const scriptOnlyToggle = $("#script-only");
scriptOnlyToggle.checked = state.scriptOnly;
scriptOnlyToggle.addEventListener("change", () => {
  state.scriptOnly = scriptOnlyToggle.checked;
  localStorage.setItem("astra-script-only", state.scriptOnly ? "1" : "0");
  paintCountries();
  renderStars();
  renderConstellation();
  paintCounters();
  if (state.selected) renderPanel();
  paintTicker();
});

(async () => {
  await loadWorld();
  await refineDetectedCountry();
  layoutMap();
  paintCountries();
  paintYouChip();
  paintTicker();
  await refreshSummary();
  await refreshFeed();
  setInterval(() => { refreshSummary(); refreshFeed(); }, 20000);
})();

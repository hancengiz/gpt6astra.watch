// gpt6astra.watch — cosmic map app
import { geoNaturalEarth1, geoPath, geoCentroid, geoGraticule10 } from "./assets/vendor/d3-geo.esm.js";
import { feature } from "./assets/vendor/topojson-client.esm.js";
import { CRIMEA_UKRAINE_FEATURE } from "./crimea.js";
import { statusForView, totalsForView, VIEW_MODES } from "./view_modes.js";

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

// Legacy IANA timezone reference. It is intentionally not used for country
// attribution because timezone is not a reliable country signal.
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

// Country attribution must come from the request edge or an explicit user
// choice. Browser timezone is deliberately not used because it can silently
// assign the wrong country when a timezone spans borders or a user is traveling.
const initialCountry = null;
const savedViewMode = localStorage.getItem("astra-view-mode");
const initialViewMode = VIEW_MODES.has(savedViewMode)
  ? savedViewMode
  : (localStorage.getItem("astra-script-only") === "1" ? "script" : "all");

const state = {
  countries: [],        // [{iso, name, feature, centroid, d}]
  countryOptions: [],   // complete server-authoritative country catalog
  byIso: new Map(),
  summary: { countries: {}, totals: {
    lit: 0, reported: 0, rumored: 0, reports: 0,
    waiting: 0, waiting_web: 0, waiting_watcher: 0, monitoring: 0,
  } },
  selected: null,
  myCountry: initialCountry,
  detectedCountry: initialCountry,
  lastFeedId: 0,
  tickEvents: [],       // [{type:'report'|'lit', cc, name, ts}]
  votes: new Map(),     // server-authoritative per-country browser vote state
  voteRequests: new Map(),
  viewMode: initialViewMode,
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
const crimeaOverlay = { feature: CRIMEA_UKRAINE_FEATURE, node: null };

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
  crimeaOverlay.node?.setAttribute("d", pathGen(crimeaOverlay.feature) || "");
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

  const crimeaNode = el("path", {
    class: "country crimea-ukraine",
    "data-iso": "UA",
    d: "",
  });
  const title = document.createElementNS(svgNS, "title");
  title.textContent = "Crimea and Sevastopol — Ukraine (UA)";
  crimeaNode.append(title);
  crimeaNode.addEventListener("click", () => selectCountry("UA"));
  crimeaOverlay.node = crimeaNode;
  // Appending last makes the Ukraine-owned overlay authoritative over the
  // older Natural Earth world shape, which assigns these areas to Russia.
  gCountries.append(crimeaNode);
}

async function loadCountryOptions() {
  try {
    const response = await fetch("/api/countries", { cache: "no-store" });
    if (!response.ok) throw new Error("country catalog unavailable");
    const data = await response.json();
    if (!Array.isArray(data.countries) || !data.countries.length) {
      throw new Error("country catalog empty");
    }

    state.countryOptions = data.countries
      .filter((country) => /^[A-Z]{2}$/.test(country.code) && country.name)
      .map((country) => {
        const mapped = state.byIso.get(country.code);
        if (mapped) {
          mapped.name = country.name;
          return mapped;
        }
        const option = {
          iso: country.code,
          name: country.name,
          feature: null,
          node: null,
          xy: null,
        };
        state.byIso.set(country.code, option);
        return option;
      });
  } catch {
    // The map remains usable if the catalog request fails, but no location is
    // guessed. A valid server catalog is required to expose mapless regions.
    state.countryOptions = [...state.byIso.values()];
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
    // Leave the country undetected so the user must choose explicitly.
  }
}

function statusFromCountry(data) {
  return statusForView(data, state.viewMode);
}

function statusOf(iso) {
  return statusFromCountry(state.summary.countries[iso]);
}

function countryNodes(iso) {
  const primary = state.byIso.get(iso)?.node;
  return [primary, ...(iso === "UA" ? [crimeaOverlay.node] : [])].filter(Boolean);
}

function paintCountries() {
  for (const c of state.countries) {
    if (!c.iso || !c.node) continue;
    const data = state.summary.countries[c.iso] || {};
    const status = statusOf(c.iso);
    for (const node of countryNodes(c.iso)) {
      node.classList.remove(
        "waiting", "waiting-focus", "rumored", "reported", "live",
        "self-reported", "script-reported"
      );
      if (state.viewMode === "waiting") {
        if ((data.waiting ?? 0) > 0) node.classList.add("waiting", "waiting-focus");
        else node.classList.remove("ignite");
      } else if (status !== "none") {
        node.classList.add(status);
      } else if (state.viewMode === "all" && (data.waiting ?? 0) > 0) {
        node.classList.add("waiting");
      } else {
        node.classList.remove("ignite");
      }
      if (status !== "none" && status !== "live" &&
          (data.watcher ?? 0) > 0 && (state.viewMode === "script" || !(data.web ?? 0))) {
        node.classList.add("script-reported");
      } else if (status !== "none" && status !== "live" &&
                 (data.web ?? 0) > 0 && (state.viewMode === "got" || !(data.watcher ?? 0))) {
        node.classList.add("self-reported");
      }
    }
  }
}

function renderStars() {
  gStars.replaceChildren();
  if (state.viewMode === "waiting") {
    for (const c of state.countries) {
      const waiting = state.summary.countries[c.iso]?.waiting ?? 0;
      if (!c.iso || !c.xy || waiting < 1) continue;
      const scale = 0.9 + Math.min(0.7, Math.log2(waiting + 1) * 0.18);
      const marker = el("g", {
        class: "sad-marker",
        transform: `translate(${c.xy[0]},${c.xy[1]}) scale(${scale})`,
      });
      const title = el("title");
      title.textContent = `${c.name}: ${waiting.toLocaleString()} desperately waiting`;
      marker.append(
        title,
        el("circle", { class: "sad-face", cx: 0, cy: 0, r: 8.5 }),
        el("circle", { class: "sad-eye", cx: -3, cy: -2, r: 1 }),
        el("circle", { class: "sad-eye", cx: 3, cy: -2, r: 1 }),
        el("path", { class: "sad-mouth", d: "M-4,4 Q0,0 4,4" }),
        el("path", {
          class: "sad-tear",
          d: "M4,-0.5 C6,1.8 6,3.8 4,4.8 C2,4 2,1.8 4,-0.5 Z",
        }),
      );
      marker.style.animationDelay = `${(c.iso.charCodeAt(0) + c.iso.charCodeAt(1)) % 17 / 10}s`;
      gStars.append(marker);
    }
    return;
  }
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
  const nodes = countryNodes(iso);
  if (!nodes.length) return;
  for (const node of nodes) node.classList.remove("ignite");
  void nodes[0].getBBox; // reflow to restart animation
  for (const node of nodes) node.classList.add("ignite");
  setTimeout(() => nodes.forEach((node) => node.classList.remove("ignite")), 2500);
}

/* ---------------------------------------------------------------- counters */

const counters = {
  lit: $("#c-lit"),
  waiting: $("#c-waiting"),
  monitoring: $("#c-monitoring"),
  reports: $("#c-reports"),
};
const prevTotals = { lit: null, waiting: null, monitoring: null, reports: null };

function viewTotals() {
  return totalsForView(state.summary, state.viewMode);
}

function paintCounters() {
  const totals = viewTotals();
  for (const key of ["lit", "waiting", "monitoring", "reports"]) {
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
  document.title = state.viewMode === "waiting" && totals.waiting > 0
    ? `(${totals.waiting} waiting ☹) gpt6astra.watch`
    : totals.lit > 0
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
  for (const node of countryNodes(iso)) node.classList.add("selected");
  renderPanel();
  hydrateVote(iso);
}

function closePanel() {
  state.selected = null;
  panel.hidden = true;
  for (const node of gCountries.children) node.classList.remove("selected");
}

function statusLabel(data, status = statusFromCountry(data)) {
  if (status === "live") return "✦ Lit";
  if (status === "none") {
    const showsWaiting = state.viewMode === "all" || state.viewMode === "waiting";
    return showsWaiting && (data.waiting ?? 0) > 0 ? "☹ Still waiting" : "Still dark";
  }
  if (state.viewMode === "script" || ((data.watcher ?? 0) > 0 && !(data.web ?? 0))) {
    return "Script reported";
  }
  if (state.viewMode === "got" || ((data.web ?? 0) > 0 && !(data.watcher ?? 0))) {
    return "Self reported";
  }
  return "Reported";
}

function voteCacheKey(iso) {
  return `astra-vote-${iso}`;
}

function cachedVote(iso) {
  const vote = localStorage.getItem(voteCacheKey(iso));
  if (vote === "waiting" || vote === "available") {
    return { vote, can_manage: true, cached: true };
  }
  if (localStorage.getItem(`astra-reported-${iso}`)) {
    return { vote: "available", can_manage: true, cached: true };
  }
  return null;
}

function rememberVote(iso, voteState) {
  if (voteState?.vote === "waiting" || voteState?.vote === "available") {
    localStorage.setItem(voteCacheKey(iso), voteState.vote);
    if (voteState.vote === "available") {
      localStorage.setItem(`astra-reported-${iso}`, String(Date.now()));
    } else {
      localStorage.removeItem(`astra-reported-${iso}`);
    }
  } else {
    localStorage.removeItem(voteCacheKey(iso));
    localStorage.removeItem(`astra-reported-${iso}`);
  }
}

function personalVote(iso) {
  return state.votes.get(iso) || cachedVote(iso);
}

async function hydrateVote(iso) {
  if (state.voteRequests.has(iso)) return state.voteRequests.get(iso);
  const pending = (async () => {
    try {
      const response = await fetch(`/api/vote?country=${encodeURIComponent(iso)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      state.votes.set(iso, data);
      rememberVote(iso, data);
      if (state.selected === iso) renderPanel();
    } catch {
      // The local cache remains a temporary UI fallback while offline.
    } finally {
      state.voteRequests.delete(iso);
    }
  })();
  state.voteRequests.set(iso, pending);
  return pending;
}

function renderPanel() {
  const iso = state.selected;
  const c = state.byIso.get(iso);
  if (!c || !iso) return;
  const d = state.summary.countries[iso] || {};
  const viewStatus = statusOf(iso);
  const mine = personalVote(iso);

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
  const showsWaiting = state.viewMode === "all" || state.viewMode === "waiting";
  const chipStatus = viewStatus === "none" && showsWaiting && (d.waiting ?? 0) > 0
    ? "waiting"
    : viewStatus;
  chip.className = `status-chip ${chipStatus}`;
  chip.textContent = statusLabel(d, viewStatus);
  statusLine.append(chip);
  if (viewStatus === "live" && d.first_at && state.viewMode === "all") {
    const since = document.createElement("span");
    since.textContent = `first seen ${relTime(d.first_at)}`;
    statusLine.append(since);
  }

  const stats = document.createElement("div");
  stats.className = "stats";
  const showGot = state.viewMode === "all" || state.viewMode === "got";
  const showWaiting = state.viewMode === "all" || state.viewMode === "waiting";
  const showScript = state.viewMode === "all" || state.viewMode === "script";
  const manualGot = showGot ? (d.web ?? 0).toLocaleString() : "—";
  const waiting = showWaiting ? (d.waiting ?? 0).toLocaleString() : "—";
  const verifiedWaiting = d.waiting_watcher ?? 0;
  const waitingLabel = showWaiting
    ? verifiedWaiting > 0
      ? `still waiting · ${verifiedWaiting.toLocaleString()} script verified`
      : "still waiting"
    : "waiting votes hidden";
  stats.innerHTML = `
    <div><b>${manualGot}</b><span>${showGot ? "people got it" : "got-it votes hidden"}</span></div>
    <div><b>${waiting}</b><span>${waitingLabel}</span></div>
    <div><b>${showScript ? (d.watcher ?? 0).toLocaleString() : "—"}</b><span>${showScript ? "account signals" : "script signals hidden"}</span></div>
    <div><b>${showScript ? (d.monitoring ?? 0).toLocaleString() : "—"}</b><span>${showScript ? "monitoring now" : "monitoring hidden"}</span></div>`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (mine?.network_claimed && !mine.can_manage) {
    const notice = document.createElement("div");
    notice.className = "vote-notice";
    notice.textContent = "A response from this network is already counted. Use the original browser to change it.";
    actions.append(notice);
  } else if (mine?.vote === "available") {
    const thanks = document.createElement("div");
    thanks.className = "thanks";
    thanks.textContent = mine.was_waiting
      ? "Your waiting vote became a star ✦"
      : "You're counted. Welcome to the constellation ✦";
    const correction = document.createElement("button");
    correction.className = "btn btn-ghost";
    correction.type = "button";
    correction.textContent = mine.was_waiting
      ? "Reported by mistake? Back to waiting"
      : "Reported by mistake? Undo";
    correction.onclick = () => mine.was_waiting
      ? submitVote(iso, "waiting", correction)
      : removeVote(iso, correction);
    actions.append(thanks, correction);
  } else if (mine?.vote === "waiting") {
    const waitingNotice = document.createElement("div");
    waitingNotice.className = "thanks waiting";
    waitingNotice.textContent = "You're counted among those still waiting.";
    const gotIt = document.createElement("button");
    gotIt.className = "btn btn-primary";
    gotIt.type = "button";
    gotIt.textContent = "✦ I got Astra now";
    gotIt.onclick = () => submitVote(iso, "available", gotIt);
    const remove = document.createElement("button");
    remove.className = "btn btn-ghost btn-quiet";
    remove.type = "button";
    remove.textContent = "Remove my response";
    remove.onclick = () => removeVote(iso, remove);
    actions.append(waitingNotice, gotIt, remove);
  } else {
    const gotIt = document.createElement("button");
    gotIt.className = "btn btn-primary";
    gotIt.type = "button";
    gotIt.textContent = `✦ I got Astra — light up ${c.name}`;
    gotIt.onclick = () => submitVote(iso, "available", gotIt);
    const waiting = document.createElement("button");
    waiting.className = "btn btn-ghost";
    waiting.type = "button";
    waiting.textContent = "I don't have Astra yet";
    waiting.onclick = () => submitVote(iso, "waiting", waiting);
    actions.append(gotIt, waiting);
  }

  const watch = document.createElement("a");
  watch.className = "btn btn-ghost";
  watch.href = "/skill";
  watch.textContent = "⌁ Join the Stargazers (get the script)";
  actions.append(watch);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = {
    all: "Waiting votes never light a country. Positive reports remain crowd signals; use a watcher for proof on your own account.",
    got: "Showing only people who manually reported that Astra reached them.",
    waiting: "Showing the waiting room ☹ Sad faces grow as more people wait, but never light a country.",
    script: "Showing only access reports sent by consented skill/script watchers. Manual votes are hidden.",
  }[state.viewMode];

  panel.append(close, flag, h2, statusLine, stats, actions, hint);
  panel.hidden = false;
}

function confirmCountryMismatch(iso, vote) {
  const detectedIso = state.detectedCountry;
  if (!detectedIso || detectedIso === iso) return true;
  const detectedName = state.byIso.get(detectedIso)?.name || detectedIso;
  const reportName = state.byIso.get(iso)?.name || iso;
  if (vote === "waiting") {
    return window.confirm(
      `Your current sky looks like ${detectedName}. Are you sure you're reporting that you are still waiting in ${reportName}?`
    );
  }
  const questions = [
    `Tiny telescope check: your current sky looks like ${detectedName}, but you're reporting ${reportName}. Did Astra really land there?`,
    `Constellation double-check: ${reportName}, not ${detectedName} — are you absolutely sure?`,
    `Final launch key: promise this ${reportName} report is real and you'll help keep the community sky honest?`,
  ];
  return questions.every((question) => window.confirm(question));
}

async function submitVote(iso, vote, btn) {
  if (!confirmCountryMismatch(iso, vote)) {
    toast("Launch aborted — no stars were harmed ✦");
    return;
  }
  btn.disabled = true;
  btn.textContent = vote === "available" ? "Lighting it up…" : "Counting your sky…";
  try {
    const res = await fetch("/api/vote", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: iso, vote, nickname: "" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed");
    state.votes.set(iso, data);
    rememberVote(iso, data);
    if (data.network_claimed) {
      toast(data.message || "A response from this network is already counted.");
    } else if (vote === "available") {
      burstAt(iso);
      ignite(iso);
      toast(data.converted ? "You got it — your waiting vote is now a star ✦" : "Lit ✦ thanks for reporting");
    } else {
      toast(data.converted_back ? "Corrected — you're back among those still waiting." : "Counted — we hope Astra reaches you soon ✦");
    }
    await refreshSummary(true);
    renderPanel();
  } catch {
    toast("Could not update your response — try again in a moment");
    btn.disabled = false;
    btn.textContent = vote === "available" ? "✦ I got Astra" : "I don't have Astra yet";
  }
}

async function removeVote(iso, btn) {
  btn.disabled = true;
  btn.textContent = "Correcting the sky…";
  try {
    const res = await fetch("/api/vote", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: iso }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed");
    state.votes.set(iso, data);
    rememberVote(iso, null);
    toast(data.removed
      ? "Response removed — thanks for keeping the constellation honest ✦"
      : "That response was already gone.");
    await refreshSummary(true);
    renderPanel();
  } catch {
    toast("Could not remove this response — the private browser key may be missing");
    btn.disabled = false;
    btn.textContent = "Remove my response";
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
  const reportButton = $("#you-got");
  if (!state.byIso.size) return;
  if (!select.options.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Country not detected — choose yours";
    placeholder.disabled = true;
    select.append(placeholder);

    const sorted = [...state.countryOptions].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sorted) {
      const opt = document.createElement("option");
      opt.value = c.iso;
      opt.textContent = `${c.name}`;
      select.append(opt);
    }
    select.value = state.myCountry || "";
    reportButton.disabled = !select.value;
    select.addEventListener("change", () => {
      state.myCountry = select.value;
      state.detectedCountry = null;
      reportButton.disabled = !select.value;
      selectCountry(select.value);
    });
    reportButton.addEventListener("click", () => {
      if (!select.value) {
        toast("Choose your country before reporting your status.");
        return;
      }
      selectCountry(select.value);
    });
  }
  chip.hidden = false;
  const c = state.byIso.get(state.myCountry) || null;
  $("#you-text").innerHTML = c
    ? `Your sky: <strong>${flagOf(c.iso)} ${c.name}</strong> — ${statusLabel(state.summary.countries[c.iso] || {}, statusOf(c.iso)).toLowerCase()}`
    : `Country not detected — choose yours:`;
}

/* ---------------------------------------------------------------- ticker */

function pushTick(event) {
  state.tickEvents.push(event);
  if (state.tickEvents.length > 24) state.tickEvents.shift();
  paintTicker();
}

function paintTicker() {
  const track = $("#ticker-track");
  if (state.viewMode === "waiting") {
    const items = Object.entries(state.summary.countries)
      .filter(([, country]) => (country.waiting ?? 0) > 0)
      .sort((a, b) => (b[1].waiting ?? 0) - (a[1].waiting ?? 0))
      .slice(0, 16)
      .map(([iso, country]) => {
        const name = state.byIso.get(iso)?.name || iso;
        const count = country.waiting ?? 0;
        return `<span class="tick waiting-event"><span class="t-face">☹</span>` +
          `<strong>${name}</strong>: ${count.toLocaleString()} ${count === 1 ? "person is" : "people are"} staring dramatically at the sky</span>`;
      });
    if (!items.length) {
      items.push('<span class="tick waiting-event"><span class="t-face">☹</span>the waiting room is suspiciously empty…</span>');
    }
    const html = items.join("");
    track.innerHTML = html + html;
    return;
  }
  const visibleEvents = state.viewMode === "script"
    ? state.tickEvents.filter((event) => event.type === "report" && event.source === "watcher")
    : state.viewMode === "got"
      ? state.tickEvents.filter((event) => event.type === "report" && event.source === "web")
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
    const empty = state.viewMode === "script"
      ? "waiting for the first account signal…"
      : state.viewMode === "got"
        ? "waiting for someone to report that Astra landed…"
        : "waiting for the first reports… be the star that breaks the dark ✦";
    items.push(`<span class="tick">${empty}</span>`);
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

const mapViewSelect = $("#map-view");
mapViewSelect.value = state.viewMode;
mapViewSelect.addEventListener("change", () => {
  state.viewMode = VIEW_MODES.has(mapViewSelect.value) ? mapViewSelect.value : "all";
  localStorage.setItem("astra-view-mode", state.viewMode);
  localStorage.removeItem("astra-script-only");
  paintCountries();
  renderStars();
  renderConstellation();
  paintCounters();
  if (state.selected) renderPanel();
  paintTicker();
});

(async () => {
  await loadWorld();
  await loadCountryOptions();
  await refineDetectedCountry();
  layoutMap();
  paintCountries();
  paintYouChip();
  paintTicker();
  await refreshSummary();
  await refreshFeed();
  setInterval(() => { refreshSummary(); refreshFeed(); }, 20000);
})();

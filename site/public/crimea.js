// Crimea and Sevastopol are part of Ukraine for location attribution and map
// rendering in this project. Boundary coordinates are a simplified derivative
// of geoBoundaries gbOpen UKR ADM1 (OpenStreetMap contributors, ODbL 1.0),
// pinned to release commit 9469f09.
export const CRIMEA_UKRAINE_FEATURE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Autonomous Republic of Crimea", iso: "UA-43" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [32.7727,45.8266],[33.5407,46.012],[33.5912,46.0612],
          [33.5721,46.1026],[33.6413,46.1424],[33.6152,46.2262],
          [33.6459,46.2302],[33.74,46.1852],[33.8487,46.1997],
          [34.1844,46.0669],[34.3396,46.0579],[34.4762,45.9441],
          [34.5612,45.9944],[34.6285,45.9864],[34.8022,45.9006],
          [34.7991,45.8105],[34.9598,45.7566],[35.2334,45.7917],
          [35.4597,45.5603],[35.5748,45.4895],[35.6502,45.5926],
          [35.7852,45.6433],[35.9818,45.6167],[36.3387,45.6715],
          [36.6684,45.6266],[36.6635,45.3599],[36.5305,45.1992],
          [36.6097,44.9407],[36.4914,44.8693],[36.2558,44.8219],
          [36.1028,44.8336],[35.8199,44.7923],[35.6322,44.8491],
          [35.1774,44.5973],[34.9292,44.6109],[34.7358,44.5848],
          [34.6661,44.5472],[34.5414,44.3954],[34.2375,44.2322],
          [33.9713,44.1854],[33.6966,44.191],[33.7619,44.3895],
          [33.9262,44.4213],[33.8272,44.5713],[33.7163,44.6204],
          [33.777,44.6903],[33.6161,44.712],[33.6137,44.7498],
          [33.6772,44.7862],[33.2952,44.9405],[33.0111,45.0149],
          [32.8315,45.1508],[32.5724,45.1183],[32.3624,45.1711],
          [32.2357,45.2758],[32.2034,45.4248],[32.2974,45.5749],
          [32.7727,45.8266],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { name: "Sevastopol", iso: "UA-40" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [33.2952,44.9405],[33.6772,44.7862],[33.6137,44.7498],
          [33.6161,44.712],[33.777,44.6903],[33.7163,44.6204],
          [33.7801,44.6128],[33.8972,44.4788],[33.9262,44.4213],
          [33.7619,44.3895],[33.6966,44.191],[33.2954,44.3348],
          [33.1103,44.506],[33.1058,44.6451],[33.2463,44.7633],
          [33.2952,44.9405],
        ]],
      },
    },
  ],
};

function pointInRing(longitude, latitude, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > latitude) !== (previousY > latitude) &&
        longitude < ((previousX - x) * (latitude - y)) / (previousY - y) + x) {
      inside = !inside;
    }
  }
  return inside;
}

export function isCrimeaCoordinate(longitude, latitude) {
  const x = Number(longitude);
  const y = Number(latitude);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return CRIMEA_UKRAINE_FEATURE.features.some((feature) =>
    pointInRing(x, y, feature.geometry.coordinates[0])
  );
}

function normalizedPlace(value) {
  return String(value || "").normalize("NFKD").toLowerCase();
}

export function isCrimeaLocation(location) {
  const country = String(location?.country || "").toUpperCase();
  const regionCode = String(location?.regionCode || "").trim().toUpperCase();
  const place = `${normalizedPlace(location?.region)} ${normalizedPlace(location?.city)}`;

  if (/crimea|krym|qirim|крим|крым|sevastopol|севастопол/.test(place)) return true;
  if (country === "UA" && ["40", "43", "UA-40", "UA-43"].includes(regionCode)) return true;
  if (country === "RU" && ["CR", "SEV", "RU-CR", "RU-SEV", "UA-40", "UA-43"].includes(regionCode)) {
    return true;
  }
  return isCrimeaCoordinate(location?.longitude, location?.latitude);
}

export function requestLocation(request) {
  const cf = request.cf || {};
  return {
    country: cf.country || request.headers.get("cf-ipcountry") || "",
    region: cf.region || request.headers.get("cf-region") || "",
    regionCode: cf.regionCode || request.headers.get("cf-region-code") || "",
    city: cf.city || request.headers.get("cf-city") || "",
    latitude: cf.latitude ?? request.headers.get("cf-latitude"),
    longitude: cf.longitude ?? request.headers.get("cf-longitude"),
  };
}

export function normalizedRequestCountry(request, supportedCountries) {
  const location = requestLocation(request);
  const crimeaNormalized = isCrimeaLocation(location);
  const candidate = crimeaNormalized ? "UA" : String(location.country || "").toUpperCase();
  return {
    country: supportedCountries.has(candidate) ? candidate : null,
    crimeaNormalized,
  };
}

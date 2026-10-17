/**
 * Notable downtown Toronto buildings — matched to 3D Massing footprints by lat/lon.
 * Coordinates are approximate building centres (WGS84).
 */

export type TorontoLandmark = {
  id: string;
  name: string;
  short?: string;
  lat: number;
  lon: number;
  /** Expected height band helps pick the right massing polygon when several overlap. */
  minH?: number;
  maxH?: number;
  kind?: 'tower' | 'arena' | 'station' | 'civic' | 'hotel' | 'stadium' | 'landmark' | 'residential' | 'office';
};

export const ORIGIN = { lat: 43.6426, lon: -79.3871 };

export function lonLatToLocal(lon: number, lat: number) {
  const x = (lon - ORIGIN.lon) * Math.cos((ORIGIN.lat * Math.PI) / 180) * 111_320;
  const z = -(lat - ORIGIN.lat) * 110_540;
  return { x, z };
}

export const TORONTO_LANDMARKS: TorontoLandmark[] = [
  // Waterfront / Raildeck
  { id: 'cn-tower', name: 'CN Tower', lat: 43.6426, lon: -79.3871, minH: 400, kind: 'landmark' },
  { id: 'rogers-centre', name: 'Rogers Centre', lat: 43.6414, lon: -79.3894, minH: 20, maxH: 90, kind: 'stadium' },
  { id: 'ripleys', name: "Ripley's Aquarium", short: 'Ripley Aquarium', lat: 43.6426, lon: -79.3860, minH: 10, maxH: 40, kind: 'landmark' },
  { id: 'mtcc-north', name: 'MTCC — North Building', short: 'MTCC North', lat: 43.6438, lon: -79.3865, minH: 15, maxH: 55, kind: 'civic' },
  { id: 'mtcc-south', name: 'MTCC — South Building', short: 'MTCC South', lat: 43.6428, lon: -79.3878, minH: 15, maxH: 50, kind: 'civic' },
  { id: 'scotiabank-arena', name: 'Scotiabank Arena', lat: 43.6435, lon: -79.3791, minH: 25, maxH: 70, kind: 'arena' },
  { id: 'union-station', name: 'Union Station', lat: 43.6453, lon: -79.3806, minH: 15, maxH: 55, kind: 'station' },
  { id: 'union-pearson', name: 'Union Pearson Express', short: 'UP Express', lat: 43.6448, lon: -79.3795, minH: 10, maxH: 40, kind: 'station' },
  { id: 'royal-york', name: 'Fairmont Royal York', short: 'Royal York', lat: 43.6460, lon: -79.3814, minH: 80, maxH: 140, kind: 'hotel' },
  { id: 'delta-toronto', name: 'Delta Hotels Toronto', short: 'Delta Toronto', lat: 43.6432, lon: -79.3835, minH: 120, kind: 'hotel' },
  { id: 'intercontinental', name: 'InterContinental Toronto Centre', short: 'InterContinental', lat: 43.6440, lon: -79.3855, minH: 60, maxH: 120, kind: 'hotel' },

  // South Core / York Quay
  { id: 'cibc-square-1', name: 'CIBC Square — 81 Bay', short: 'CIBC Square', lat: 43.6450, lon: -79.3788, minH: 180, kind: 'tower' },
  { id: 'cibc-square-2', name: 'CIBC Square — 141 Bay', short: '141 Bay', lat: 43.6456, lon: -79.3782, minH: 150, kind: 'tower' },
  { id: 'l-tower', name: 'L Tower', lat: 43.6468, lon: -79.3765, minH: 150, kind: 'tower' },
  { id: 'one-york', name: 'One York', lat: 43.6422, lon: -79.3805, minH: 140, kind: 'tower' },
  { id: 'ten-york', name: 'Ten York', lat: 43.6405, lon: -79.3810, minH: 180, kind: 'tower' },
  { id: 'sixteen-york', name: '16 York', lat: 43.6428, lon: -79.3815, minH: 140, kind: 'tower' },
  { id: 'ice-condo-w', name: 'Ice Condos West', short: 'Ice West', lat: 43.6410, lon: -79.3798, minH: 150, kind: 'residential' },
  { id: 'ice-condo-e', name: 'Ice Condos East', short: 'Ice East', lat: 43.6412, lon: -79.3788, minH: 150, kind: 'residential' },
  { id: 'maple-leaf-square', name: 'Maple Leaf Square', lat: 43.6430, lon: -79.3798, minH: 140, kind: 'tower' },
  { id: 'rbc-waterpark', name: 'RBC WaterPark Place', short: 'WaterPark Place', lat: 43.6415, lon: -79.3782, minH: 120, kind: 'office' },
  { id: 'queens-quay-term', name: "Queen's Quay Terminal", lat: 43.6395, lon: -79.3775, minH: 20, maxH: 60, kind: 'civic' },
  { id: 'harbourfront', name: 'Harbourfront Centre', lat: 43.6389, lon: -79.3820, minH: 10, maxH: 40, kind: 'civic' },
  { id: 'harbour-plaza', name: 'Harbour Plaza Residences', short: 'Harbour Plaza', lat: 43.6408, lon: -79.3800, minH: 180, kind: 'residential' },
  { id: 'eighty-eight-qq', name: '88 Queens Quay', lat: 43.6418, lon: -79.3755, minH: 120, kind: 'office' },
  { id: 'sugar-wharf-1', name: 'Sugar Wharf Tower 1', short: 'Sugar Wharf', lat: 43.6445, lon: -79.3685, minH: 180, kind: 'residential' },
  { id: 'corus-quay', name: 'Corus Quay', lat: 43.6438, lon: -79.3665, minH: 20, maxH: 70, kind: 'office' },
  { id: 'redpath', name: 'Redpath Sugar Refinery', short: 'Redpath', lat: 43.6440, lon: -79.3650, minH: 20, maxH: 80, kind: 'landmark' },
  { id: 'pier-27', name: 'Pier 27', lat: 43.6430, lon: -79.3705, minH: 80, kind: 'residential' },
  { id: 'monde', name: 'Monde Condos', short: 'Monde', lat: 43.6448, lon: -79.3695, minH: 140, kind: 'residential' },

  // Financial District
  { id: 'first-canadian', name: 'First Canadian Place', lat: 43.6486, lon: -79.3817, minH: 250, kind: 'tower' },
  { id: 'scotia-plaza', name: 'Scotia Plaza', lat: 43.6492, lon: -79.3789, minH: 220, kind: 'tower' },
  { id: 'td-canada-trust', name: 'TD Canada Trust Tower', short: 'TD Tower', lat: 43.6475, lon: -79.3808, minH: 200, kind: 'tower' },
  { id: 'td-bank-tower', name: 'TD Bank Tower', lat: 43.6479, lon: -79.3816, minH: 180, kind: 'tower' },
  { id: 'td-centre-ey', name: 'TD Centre — EY Tower', short: 'EY Tower', lat: 43.6478, lon: -79.3825, minH: 180, kind: 'tower' },
  { id: 'td-south', name: 'TD South Tower', lat: 43.6472, lon: -79.3820, minH: 150, kind: 'tower' },
  { id: 'commerce-court-w', name: 'Commerce Court West', short: 'Commerce Court W', lat: 43.6483, lon: -79.3795, minH: 220, kind: 'tower' },
  { id: 'commerce-court-n', name: 'Commerce Court North', short: 'Commerce Court N', lat: 43.6488, lon: -79.3790, minH: 120, maxH: 200, kind: 'office' },
  { id: 'royal-bank-plaza-s', name: 'Royal Bank Plaza South', short: 'RBC Plaza S', lat: 43.6465, lon: -79.3800, minH: 120, maxH: 200, kind: 'tower' },
  { id: 'royal-bank-plaza-n', name: 'Royal Bank Plaza North', short: 'RBC Plaza N', lat: 43.6472, lon: -79.3804, minH: 100, maxH: 180, kind: 'tower' },
  { id: 'brookfield-place', name: 'Brookfield Place', lat: 43.6469, lon: -79.3783, minH: 140, kind: 'tower' },
  { id: 'bay-adelaide-e', name: 'Bay Adelaide East', short: 'Bay Adelaide E', lat: 43.6500, lon: -79.3795, minH: 180, kind: 'tower' },
  { id: 'bay-adelaide-w', name: 'Bay Adelaide West', short: 'Bay Adelaide W', lat: 43.6505, lon: -79.3808, minH: 180, kind: 'tower' },
  { id: 'bay-wellington', name: 'Bay Wellington Tower', short: 'Bay Wellington', lat: 43.6470, lon: -79.3795, minH: 160, kind: 'tower' },
  { id: 'design-exchange', name: 'Design Exchange', lat: 43.6478, lon: -79.3800, minH: 20, maxH: 60, kind: 'civic' },
  { id: 'exchange-tower', name: 'Exchange Tower', lat: 43.6480, lon: -79.3810, minH: 140, kind: 'office' },
  { id: 'sun-life', name: 'Sun Life Centre', short: 'Sun Life', lat: 43.6495, lon: -79.3825, minH: 100, kind: 'office' },
  { id: 'toronto-dominion-centre', name: 'Toronto-Dominion Centre', short: 'TD Centre', lat: 43.6476, lon: -79.3812, minH: 160, kind: 'office' },
  { id: '100-king', name: '100 King West', lat: 43.6488, lon: -79.3828, minH: 120, kind: 'office' },
  { id: '130-king', name: '130 King West', lat: 43.6484, lon: -79.3835, minH: 100, kind: 'office' },
  { id: 'first-gulf-canada', name: 'First Gulf Canada Square', short: 'Canada Square', lat: 43.6462, lon: -79.3828, minH: 80, maxH: 160, kind: 'office' },

  // Hotels / entertainment
  { id: 'st-regis', name: 'St. Regis Toronto', short: 'St. Regis', lat: 43.6493, lon: -79.3817, minH: 220, kind: 'hotel' },
  { id: 'shangri-la', name: 'Shangri-La Toronto', short: 'Shangri-La', lat: 43.6490, lon: -79.3860, minH: 180, kind: 'hotel' },
  { id: 'ritz-carlton', name: 'Ritz-Carlton Toronto', short: 'Ritz-Carlton', lat: 43.6460, lon: -79.3868, minH: 180, kind: 'hotel' },
  { id: 'marriott-city', name: 'Toronto Marriott City Centre', short: 'Marriott City Centre', lat: 43.6438, lon: -79.3872, minH: 80, maxH: 140, kind: 'hotel' },
  { id: 'royal-alex', name: 'Royal Alexandra Theatre', short: 'Royal Alex', lat: 43.6474, lon: -79.3877, minH: 15, maxH: 50, kind: 'civic' },
  { id: 'princess-of-wales', name: 'Princess of Wales Theatre', short: 'Princess of Wales', lat: 43.6470, lon: -79.3892, minH: 15, maxH: 50, kind: 'civic' },
  { id: 'roy-thomson', name: 'Roy Thomson Hall', lat: 43.6466, lon: -79.3863, minH: 20, maxH: 55, kind: 'civic' },
  { id: 'meridian-hall', name: 'Meridian Hall', lat: 43.6465, lon: -79.3755, minH: 20, maxH: 60, kind: 'civic' },
  { id: 'sony-centre', name: 'Meridian Arts Centre', short: 'Meridian Arts', lat: 43.6462, lon: -79.3760, minH: 20, maxH: 55, kind: 'civic' },

  // King West / Entertainment District
  { id: 'tiff-lightbox', name: 'TIFF Bell Lightbox', short: 'TIFF Lightbox', lat: 43.6465, lon: -79.3905, minH: 80, maxH: 160, kind: 'civic' },
  { id: 'festival-tower', name: 'Festival Tower', lat: 43.6468, lon: -79.3908, minH: 140, kind: 'residential' },
  { id: 'cinema-tower', name: 'Cinema Tower', lat: 43.6462, lon: -79.3915, minH: 120, kind: 'residential' },
  { id: 'the-well', name: 'The Well', lat: 43.6428, lon: -79.4015, minH: 40, maxH: 140, kind: 'tower' },
  { id: 'tiffany', name: 'The Tiffany', short: 'Tiffany', lat: 43.6438, lon: -79.3925, minH: 140, kind: 'residential' },
  { id: 'nebula', name: 'Nebula Condos', short: 'Nebula', lat: 43.6445, lon: -79.3970, minH: 120, kind: 'residential' },
  { id: 'king-portland', name: 'King Portland Centre', short: 'King Portland', lat: 43.6448, lon: -79.3985, minH: 60, maxH: 140, kind: 'office' },

  // Midtown-ish edge of downtown bbox
  { id: 'city-hall', name: 'Toronto City Hall', short: 'City Hall', lat: 43.6532, lon: -79.3832, minH: 70, maxH: 120, kind: 'civic' },
  { id: 'old-city-hall', name: 'Old City Hall', lat: 43.6525, lon: -79.3817, minH: 40, maxH: 110, kind: 'civic' },
  { id: 'eaton-centre', name: 'Toronto Eaton Centre', short: 'Eaton Centre', lat: 43.6544, lon: -79.3807, minH: 20, maxH: 80, kind: 'civic' },
  { id: 'the-bay', name: "Hudson's Bay — Queen", short: 'The Bay', lat: 43.6522, lon: -79.3795, minH: 30, maxH: 90, kind: 'civic' },
  { id: 'massey-hall', name: 'Massey Hall', lat: 43.6545, lon: -79.3790, minH: 15, maxH: 50, kind: 'civic' },
  { id: 'aura', name: 'Aura at College Park', short: 'Aura', lat: 43.6610, lon: -79.3835, minH: 220, kind: 'residential' },
  { id: 'college-park', name: 'College Park', lat: 43.6605, lon: -79.3830, minH: 40, maxH: 100, kind: 'civic' },
  { id: 'hospital-sickkids', name: 'SickKids Hospital', short: 'SickKids', lat: 43.6572, lon: -79.3865, minH: 40, maxH: 120, kind: 'civic' },
  { id: 'tmh', name: 'Toronto General Hospital', short: 'TGH', lat: 43.6588, lon: -79.3885, minH: 40, maxH: 120, kind: 'civic' },
  { id: 'mahrs', name: 'MaRS Discovery District', short: 'MaRS', lat: 43.6595, lon: -79.3900, minH: 40, maxH: 100, kind: 'office' },
  { id: 'u-of-t-bahen', name: 'Bahen Centre', short: 'Bahen', lat: 43.6598, lon: -79.3970, minH: 30, maxH: 80, kind: 'civic' },
  { id: 'rom', name: 'Royal Ontario Museum', short: 'ROM', lat: 43.6677, lon: -79.3948, minH: 20, maxH: 60, kind: 'civic' },

  // St. Lawrence / East Bayfront
  { id: 'st-lawrence-market', name: 'St. Lawrence Market', lat: 43.6487, lon: -79.3715, minH: 10, maxH: 40, kind: 'civic' },
  { id: 'st-lawrence-hall', name: 'St. Lawrence Hall', lat: 43.6500, lon: -79.3720, minH: 15, maxH: 45, kind: 'civic' },
  { id: 'berczy', name: 'Berczy Park District', short: 'Berczy', lat: 43.6480, lon: -79.3745, minH: 40, maxH: 100, kind: 'residential' },
  { id: 'gooderham', name: 'Gooderham Building', short: 'Flatiron', lat: 43.6486, lon: -79.3742, minH: 15, maxH: 45, kind: 'landmark' },
  { id: 'distillery', name: 'Distillery District', lat: 43.6503, lon: -79.3596, minH: 10, maxH: 45, kind: 'civic' },
  { id: 'canary-district', name: 'Canary District', lat: 43.6520, lon: -79.3625, minH: 40, maxH: 120, kind: 'residential' },
  { id: 'river-city', name: 'River City Condos', short: 'River City', lat: 43.6535, lon: -79.3585, minH: 60, maxH: 140, kind: 'residential' },

  // University / Queen West edge
  { id: 'ocad', name: 'OCAD University', short: 'OCAD U', lat: 43.6530, lon: -79.3910, minH: 20, maxH: 55, kind: 'civic' },
  { id: 'ago', name: 'Art Gallery of Ontario', short: 'AGO', lat: 43.6536, lon: -79.3925, minH: 15, maxH: 50, kind: 'civic' },
  { id: 'cityplace-parade', name: 'CityPlace Parade', short: 'Parade', lat: 43.6395, lon: -79.3945, minH: 120, kind: 'residential' },
  { id: 'cityplace-halo', name: 'CityPlace Halo', short: 'Halo', lat: 43.6402, lon: -79.3960, minH: 120, kind: 'residential' },
  { id: 'library-district', name: 'Toronto Reference Library', short: 'Reference Library', lat: 43.6710, lon: -79.3860, minH: 20, maxH: 60, kind: 'civic' },
];

export type MatchedLandmark = {
  landmark: TorontoLandmark;
  buildingIndex: number;
  x: number;
  z: number;
  h: number;
  footprint_m2: number;
};

type BuildingRef = {
  index: number;
  x: number;
  z: number;
  h: number;
  footprint_m2: number;
};

function ringArea(ring: [number, number][]) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a * 0.5);
}

/** Greedy nearest-neighbour match with height gates; each footprint used at most once.
 *  Only real named landmarks get plates — Toronto 3D Massing has no per-building names.
 */
export function matchLandmarksToBuildings(
  buildings: { h: number; rings: [number, number][][] }[],
  maxDistM = 110,
): MatchedLandmark[] {
  const refs: BuildingRef[] = buildings.map((b, index) => {
    const ring = b.rings[0];
    const body =
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring;
    const x = body.reduce((s, p) => s + p[0], 0) / body.length;
    const z = body.reduce((s, p) => s + p[1], 0) / body.length;
    return { index, x, z, h: b.h, footprint_m2: ringArea(ring) };
  });

  const used = new Set<number>();
  const matches: MatchedLandmark[] = [];

  for (const landmark of TORONTO_LANDMARKS) {
    if (landmark.id === 'cn-tower') {
      const local = lonLatToLocal(landmark.lon, landmark.lat);
      matches.push({
        landmark,
        buildingIndex: -1,
        x: local.x,
        z: local.z,
        h: 553,
        footprint_m2: 1200,
      });
      continue;
    }

    const local = lonLatToLocal(landmark.lon, landmark.lat);
    let best: BuildingRef | null = null;
    let bestScore = Infinity;

    for (const ref of refs) {
      if (used.has(ref.index)) continue;
      if (landmark.minH != null && ref.h < landmark.minH) continue;
      if (landmark.maxH != null && ref.h > landmark.maxH) continue;
      const dist = Math.hypot(ref.x - local.x, ref.z - local.z);
      if (dist > maxDistM) continue;
      let score = dist;
      if (landmark.minH != null && landmark.maxH != null) {
        const mid = (landmark.minH + landmark.maxH) / 2;
        score += Math.abs(ref.h - mid) * 0.08;
      }
      if (score < bestScore) {
        bestScore = score;
        best = ref;
      }
    }

    if (!best) continue;
    used.add(best.index);
    matches.push({
      landmark,
      buildingIndex: best.index,
      x: best.x,
      z: best.z,
      h: best.h,
      footprint_m2: best.footprint_m2,
    });
  }

  return matches;
}

/**
 * Shared config for the ReADY extension (background + documentation).
 * Keep in sync with app.py CATEGORY_KEYWORDS / READY_URL.
 */
const READY_URL = "https://ready.app.vanderbilt.edu/ready";

/** Residential template card id — different multi-page flow */
const RESIDENTIAL_CAT_ID = "nCNEaYerZReeEF9WK";

const CATEGORY_KEYWORDS = {
  DqBtyxFmaj4FNJNFZ: {
    name: "Temperature/HVAC",
    keywords: [
      "temperature", "hvac", "hot", "cold", "heat", "ac", "air conditioning",
      "thermostat", "air filter", "filter", "vent", "ventilation", "cool",
      "warm", "freezing", "boiling",
    ],
  },
  zqmrxp5aZxTf6jbem: {
    name: "Leaks/Gas Leaks",
    keywords: [
      "leak", "leaking", "water leak", "gas leak", "drip", "dripping",
      "flooding", "flood", "water damage", "pipe",
    ],
  },
  phf3HbLdpD6eDhYko: {
    name: "Plumbing Fixtures",
    keywords: [
      "plumbing", "toilet", "sink", "faucet", "drain", "clog", "clogged",
      "shower", "bathtub", "water fountain", "fountain", "water pressure",
    ],
  },
  LatFPA6SkypytJAKY: {
    name: "Electrical",
    keywords: [
      "electrical", "electric", "outlet", "light", "lights", "power",
      "switch", "wiring", "circuit", "breaker", "lamp", "bulb",
    ],
  },
  ou4Zow2YbimZytRSr: {
    name: "Elevator",
    keywords: ["elevator", "lift", "escalator"],
  },
  Gabh7SriB59jdscgA: {
    name: "Grounds",
    keywords: [
      "grounds", "landscaping", "tree", "grass", "sidewalk", "parking",
      "snow", "ice", "pothole",
    ],
  },
  yZu5BcaGKbGTLDMei: {
    name: "Pest Control",
    keywords: [
      "pest", "bug", "bugs", "roach", "roaches", "mouse", "mice", "rat",
      "ant", "ants", "spider", "insect", "rodent", "exterminator",
    ],
  },
  KPPNddEbj7PDHD5vr: {
    name: "Dispensers",
    keywords: ["dispenser", "soap", "paper towel", "hand sanitizer", "toilet paper"],
  },
  cknuy2X6r6MzpPTCd: {
    name: "Accessibility",
    keywords: [
      "accessibility", "accessible", "ada", "ramp", "wheelchair", "handicap",
      "door opener",
    ],
  },
  AbBqKfD42693wkgkn: {
    name: "Card Reader",
    keywords: [
      "card reader", "card swipe", "door lock", "access", "badge", "key card",
      "commodore card",
    ],
  },
  nCNEaYerZReeEF9WK: {
    name: "Residential Hall Room Maintenance Issue",
    keywords: ["dorm", "residence", "residential", "room maintenance", "room issue"],
  },
  aKTFsEXAznE83ruhx: {
    name: "Greek House Room Maintenance Issue",
    keywords: ["greek", "fraternity", "sorority", "greek house"],
  },
};

const VU_BUILDINGS = [
  "Stevenson", "Rand", "Kirkland", "Sarratt", "Light Hall",
  "Wilson", "Blair", "Peabody", "Engineering", "Featheringill",
  "Jacobs", "Buttrick", "Furman", "Garland", "Calhoun",
  "Alumni", "Commons", "Hank Ingram", "Murray", "Branscomb",
  "Kissam", "Zeppos", "E. Bronson Ingram", "Rothschild", "McGill",
  "Highland", "Lewis", "Tolman", "Memorial", "Wyatt",
  "McGugin", "Recreation", "Student Rec", "Vanderbilt",
];

function matchCategory(issueText) {
  const textLower = issueText.toLowerCase();
  if (textLower.includes("my room") || textLower.includes("in my room")) {
    return [RESIDENTIAL_CAT_ID, "Residential Hall Room Maintenance Issue"];
  }
  let bestMatch = null;
  let bestScore = 0;
  for (const [catId, catInfo] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = catInfo.keywords.filter((kw) => textLower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = [catId, catInfo.name];
    }
  }
  if (!bestMatch) {
    bestMatch = ["DqBtyxFmaj4FNJNFZ", "Temperature/HVAC"];
  }
  return bestMatch;
}

function extractBuilding(issueText) {
  const textLower = issueText.toLowerCase();
  for (const b of VU_BUILDINGS) {
    if (textLower.includes(b.toLowerCase())) return b;
  }
  return null;
}

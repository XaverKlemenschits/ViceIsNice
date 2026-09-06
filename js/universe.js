// universe.js — hard-coded equity universe for Vice Is Nice.
// Each entry: { symbol, name, sector }.
// Symbol strings use Twelve Data exchange-suffix conventions:
//   - NYSE/NASDAQ (US): plain ticker, e.g. "LMT"
//   - LSE: ".L" suffix, e.g. "SHEL.L"
//   - Euronext Paris: ".PA" suffix, e.g. "HO.PA"
//   - Euronext Amsterdam: ".AS" suffix, e.g. "HEIA.AS"
// Sectors cover morally controversial industries: defence, tobacco, alcohol,
// gambling, oil, agrifood/petrochemical.
(function (global) {
  "use strict";

  const UNIVERSE = [
    // --- Defence ---
    { symbol: "LMT",   name: "Lockheed Martin",      sector: "Defence" },
    { symbol: "RTX",   name: "RTX (Raytheon)",        sector: "Defence" },
    { symbol: "NOC",   name: "Northrop Grumman",       sector: "Defence" },
    { symbol: "GD",    name: "General Dynamics",      sector: "Defence" },
    { symbol: "HO.PA", name: "Thales",                 sector: "Defence" },
    { symbol: "BAE.L", name: "BAE Systems",            sector: "Defence" },

    // --- Tobacco ---
    { symbol: "PM",    name: "Philip Morris Intl.",   sector: "Tobacco" },
    { symbol: "BTI",   name: "British American Tobacco", sector: "Tobacco" },
    { symbol: "IMB.L", name: "Imperial Brands",        sector: "Tobacco" },

    // --- Alcohol ---
    { symbol: "BUD",    name: "Anheuser-Busch InBev",  sector: "Alcohol" },
    { symbol: "DEO",    name: "Diageo",                sector: "Alcohol" },
    { symbol: "STZ",    name: "Constellation Brands",  sector: "Alcohol" },
    { symbol: "TAP",    name: "Molson Coors",          sector: "Alcohol" },
    { symbol: "HEIA.AS", name: "Heineken",             sector: "Alcohol" },

    // --- Gambling ---
    { symbol: "MGM",   name: "MGM Resorts",            sector: "Gambling" },
    { symbol: "LVS",   name: "Las Vegas Sands",        sector: "Gambling" },
    { symbol: "WYNN",  name: "Wynn Resorts",           sector: "Gambling" },
    { symbol: "CZR",   name: "Caesars Entertainment",  sector: "Gambling" },

    // --- Oil ---
    { symbol: "XOM",    name: "ExxonMobil",            sector: "Oil" },
    { symbol: "CVX",    name: "Chevron",               sector: "Oil" },
    { symbol: "COP",    name: "ConocoPhillips",        sector: "Oil" },
    { symbol: "SHEL.L", name: "Shell",                 sector: "Oil" },
    { symbol: "TTE.PA", name: "TotalEnergies",         sector: "Oil" },

    // --- Agrifood / Petrochemical ---
    { symbol: "ADM",   name: "Archer-Daniels-Midland", sector: "Agrifood/Petrochemical" },
    { symbol: "BG",    name: "Bunge",                  sector: "Agrifood/Petrochemical" },
    { symbol: "BN.PA", name: "Danone",                sector: "Agrifood/Petrochemical" },
    { symbol: "LYB",   name: "LyondellBasell",         sector: "Agrifood/Petrochemical" },
  ];

  // 29 entries above; add a few more well-known names to exceed 30 comfortably.
  const EXTRA = [
    { symbol: "MO",     name: "Altria",               sector: "Tobacco" },
    { symbol: "WMB",    name: "Williams Companies",   sector: "Oil" },
    { symbol: "ETN",    name: "Eaton",                sector: "Defence" },
    { symbol: "RIO",    name: "Rio Tinto",             sector: "Agrifood/Petrochemical" },
  ];
  for (const e of EXTRA) UNIVERSE.push(e);

  global.VINUniverse = { UNIVERSE };
})(window);

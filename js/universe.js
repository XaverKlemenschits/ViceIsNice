// universe.js — hard-coded equity universe for Vice Is Nice.
// Each entry: { symbol, exchange, name, sector }.
// Twelve Data disambiguates international listings via a separate `exchange`
// parameter, NOT via a dot-suffix on the symbol (the ".L"/".PA" convention is
// Yahoo Finance's, which Twelve Data rejects with "symbol ... is missing or
// invalid"). Exchange values used here:
//   - US (NYSE/NASDAQ): omit exchange (null) — plain ticker is unambiguous.
//   - LSE: exchange = "LSE", plain ticker (e.g. "SHEL", not "SHEL.L").
//   - Euronext (Paris/Amsterdam): exchange = "Euronext", plain ticker.
//   - OTC (where no LSE listing is indexed): exchange = "OTC".
// Sectors cover morally controversial industries: defence, tobacco, alcohol,
// gambling, oil, agrifood/petrochemical.
(function (global) {
  "use strict";

  const UNIVERSE = [
    // --- Defence ---
    { symbol: "LMT",   exchange: null,       name: "Lockheed Martin",      sector: "Defence" },
    { symbol: "RTX",   exchange: null,       name: "RTX (Raytheon)",        sector: "Defence" },
    { symbol: "NOC",   exchange: null,       name: "Northrop Grumman",       sector: "Defence" },
    { symbol: "GD",    exchange: null,       name: "General Dynamics",      sector: "Defence" },
    { symbol: "HO",    exchange: "Euronext", name: "Thales",                 sector: "Defence" },
    { symbol: "BAESF", exchange: "OTC",      name: "BAE Systems",            sector: "Defence" },

    // --- Tobacco ---
    { symbol: "PM",    exchange: null,       name: "Philip Morris Intl.",   sector: "Tobacco" },
    { symbol: "BTI",   exchange: null,       name: "British American Tobacco", sector: "Tobacco" },
    { symbol: "IMB",   exchange: "LSE",      name: "Imperial Brands",        sector: "Tobacco" },

    // --- Alcohol ---
    { symbol: "BUD",   exchange: null,       name: "Anheuser-Busch InBev",  sector: "Alcohol" },
    { symbol: "DEO",   exchange: null,       name: "Diageo",                sector: "Alcohol" },
    { symbol: "STZ",   exchange: null,       name: "Constellation Brands",  sector: "Alcohol" },
    { symbol: "TAP",   exchange: null,       name: "Molson Coors",          sector: "Alcohol" },
    { symbol: "HEIA",  exchange: "Euronext", name: "Heineken",             sector: "Alcohol" },

    // --- Gambling ---
    { symbol: "MGM",   exchange: null,       name: "MGM Resorts",            sector: "Gambling" },
    { symbol: "LVS",   exchange: null,       name: "Las Vegas Sands",        sector: "Gambling" },
    { symbol: "WYNN",  exchange: null,       name: "Wynn Resorts",           sector: "Gambling" },
    { symbol: "CZR",   exchange: null,       name: "Caesars Entertainment",  sector: "Gambling" },

    // --- Oil ---
    { symbol: "XOM",   exchange: null,       name: "ExxonMobil",            sector: "Oil" },
    { symbol: "CVX",   exchange: null,       name: "Chevron",               sector: "Oil" },
    { symbol: "COP",   exchange: null,       name: "ConocoPhillips",        sector: "Oil" },
    { symbol: "SHEL",  exchange: "LSE",      name: "Shell",                 sector: "Oil" },
    { symbol: "TTE",   exchange: "Euronext", name: "TotalEnergies",         sector: "Oil" },

    // --- Agrifood / Petrochemical ---
    { symbol: "ADM",   exchange: null,       name: "Archer-Daniels-Midland", sector: "Agrifood/Petrochemical" },
    { symbol: "BG",    exchange: null,       name: "Bunge",                  sector: "Agrifood/Petrochemical" },
    { symbol: "BN",    exchange: "Euronext", name: "Danone",                sector: "Agrifood/Petrochemical" },
    { symbol: "LYB",   exchange: null,       name: "LyondellBasell",         sector: "Agrifood/Petrochemical" },
  ];

  // 29 entries above; add a few more well-known names to exceed 30 comfortably.
  const EXTRA = [
    { symbol: "MO",     exchange: null, name: "Altria",               sector: "Tobacco" },
    { symbol: "WMB",    exchange: null, name: "Williams Companies",   sector: "Oil" },
    { symbol: "ETN",    exchange: null, name: "Eaton",                sector: "Defence" },
    { symbol: "RIO",    exchange: null, name: "Rio Tinto",             sector: "Agrifood/Petrochemical" },
  ];
  for (const e of EXTRA) UNIVERSE.push(e);

  global.VINUniverse = { UNIVERSE };
})(window);

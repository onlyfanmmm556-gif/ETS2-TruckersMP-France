/**
 * debug-api.js — Trucky API Explorer
 * Lance ce script pour trouver le bon endpoint leaderboard France.
 *
 * Usage : node debug-api.js
 */
const axios = require("axios");

const BOT_NAME = process.env.BOT_NAME || "TruckyStatsBotFR";

const api = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 15000,
});

function extractItems(raw) {
  if (Array.isArray(raw))                                      return raw;
  if (Array.isArray(raw.response))                             return raw.response;
  if (Array.isArray(raw.data))                                 return raw.data;
  if (Array.isArray(raw.companies))                            return raw.companies;
  if (raw.response?.data && Array.isArray(raw.response.data)) return raw.response.data;
  return [];
}

async function testEndpoint(label, path, params = {}) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔍  TEST : ${label}`);
  console.log(`    GET ${path}`, params);
  try {
    const r = await api.get(path, { params });
    console.log(`    ✅ HTTP ${r.status}`);
    console.log(`    📦 Top-level keys : ${Object.keys(r.data).join(", ")}`);
    const items = extractItems(r.data);
    console.log(`    📋 Items : ${items.length}`);
    if (items.length > 0) {
      console.log(`    🔑 Clés du 1er item : ${Object.keys(items[0]).join(", ")}`);
      // Affiche les 3 premiers (name + champs km)
      items.slice(0, 3).forEach((c, i) => {
        const km =
          c.real_km ?? c.km ?? c.distance ?? c.total_km ??
          c.stats?.real_km ?? c.stats?.km ?? "?";
        const country = c.country ?? c.country_code ?? c.language ?? "?";
        console.log(`      ${i + 1}. ${c.name ?? c.company_name ?? "?"} | country: ${country} | km: ${km}`);
      });
    }
  } catch (err) {
    const status = err.response?.status ?? "ERR";
    console.log(`    ❌ HTTP ${status} — ${err.message}`);
    if (err.response?.data) {
      console.log(`    Réponse : ${JSON.stringify(err.response.data).slice(0, 200)}`);
    }
  }
}

(async () => {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         DEBUG — Trucky API Leaderboard France            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ── 1. Endpoint leaderboard principal (plusieurs variantes) ──
  await testEndpoint("Leaderboard global (ets2, km)",
    "/leaderboards", { game: "ets2", type: "km", limit: 30 });

  await testEndpoint("Leaderboard filtré France",
    "/leaderboards", { game: "ets2", type: "km", country: "FR", limit: 30 });

  await testEndpoint("Leaderboard companies",
    "/leaderboards/companies", { game: "ets2", country_code: "FR", limit: 30 });

  await testEndpoint("Leaderboard companies (country=FR)",
    "/leaderboards/companies", { country: "FR", game: "ets2" });

  await testEndpoint("Leaderboard distance",
    "/leaderboards/distance", { country_code: "FR", limit: 30 });

  // ── 2. Companies filtrées par pays ──
  await testEndpoint("Companies country=FR page 1",
    "/companies", { country: "FR", page: 1, limit: 10 });

  await testEndpoint("Companies country_code=FR",
    "/companies", { country_code: "FR", page: 1, limit: 10 });

  await testEndpoint("Companies language=French",
    "/companies", { language: "French", page: 1, limit: 10 });

  // ── 3. Stats globales ──
  await testEndpoint("Stats globales",
    "/stats", {});

  await testEndpoint("Stats companies",
    "/companies/stats", {});

  console.log(`\n${"═".repeat(60)}`);
  console.log("✅  Debug terminé — Identifie l'endpoint ✅ avec des items");
  console.log("   Ensuite mets à jour MAX_COMPANIES=30 et l'endpoint dans index.js");
})();

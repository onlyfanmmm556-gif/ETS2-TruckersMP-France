/**
 * debug-api.js
 * Lance ce script UNE FOIS sur Railway (ou en local) pour voir
 * la vraie structure de l'API Trucky et identifier les bons champs.
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
  if (Array.isArray(raw))                        return raw;
  if (Array.isArray(raw.response))               return raw.response;
  if (Array.isArray(raw.data))                   return raw.data;
  if (Array.isArray(raw.companies))              return raw.companies;
  if (raw.response?.data && Array.isArray(raw.response.data)) return raw.response.data;
  return [];
}

(async () => {
  console.log("=== DEBUG API Trucky ===\n");
  try {
    const r = await api.get("/companies", { params: { page: 1, limit: 10 } });
    console.log("✅ HTTP Status :", r.status);
    console.log("📦 Top-level keys :", Object.keys(r.data).join(", "));

    const items = extractItems(r.data);
    console.log(`📋 Items trouvés : ${items.length}\n`);

    if (items.length > 0) {
      console.log("🔑 Clés du 1er item :", Object.keys(items[0]).join(", "));
      console.log("\n📄 Contenu complet du 1er item :");
      console.log(JSON.stringify(items[0], null, 2));

      console.log("\n--- Recherche des champs pertinents ---");
      const first = items[0];
      const searchFields = ["country", "country_code", "country_name", "real_km", "distance_real",
        "km_real", "members", "members_count", "jobs_count", "deliveries", "language", "tag"];
      searchFields.forEach(f => {
        const val = first[f];
        if (val !== undefined) console.log(`  ${f} = ${JSON.stringify(val)}`);
      });

      // Chercher récursivement dans les sous-objets
      console.log("\n--- Sous-objets ---");
      Object.entries(first).forEach(([k, v]) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          console.log(`  ${k} :`, JSON.stringify(v).slice(0, 200));
        }
      });

      console.log("\n--- Echantillon de 5 items (name + country + km) ---");
      items.slice(0, 5).forEach((c, i) => {
        console.log(`${i+1}. ${c.name ?? "?"} | country: ${c.country ?? c.country_code ?? c.country_name ?? "?"} | real_km: ${c.real_km ?? c.stats?.real_km ?? "?"}`);
      });
    }
  } catch (err) {
    console.error("❌ Erreur :", err.response?.status, err.message);
    if (err.response?.headers?.["x-deny-reason"]) {
      console.error("   Raison :", err.response.headers["x-deny-reason"]);
    }
  }
})();

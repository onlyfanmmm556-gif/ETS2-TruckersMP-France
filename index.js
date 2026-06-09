const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

// ─────────────────────────────────────────────
//  Configuration via variables d'environnement
// ─────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const STATS_INTERVAL = process.env.STATS_INTERVAL || "0 * * * *";
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "10");
const BOT_NAME       = process.env.BOT_NAME || "TruckyStatsBotFR";

// Valeurs possibles du champ "country" dans l'API Trucky pour la France
const FRENCH_COUNTRY_VALUES = [
  "france", "fr", "french", "france (fr)", "fra"
];

// ─────────────────────────────────────────────
//  Client HTTP Trucky
// ─────────────────────────────────────────────
const truckyApi = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 20000,
});

// ─────────────────────────────────────────────
//  Helper : extraire les items d'une réponse API
//  (l'API Trucky peut retourner plusieurs structures)
// ─────────────────────────────────────────────
function extractItems(raw) {
  if (Array.isArray(raw))                        return raw;
  if (Array.isArray(raw.response))               return raw.response;
  if (Array.isArray(raw.data))                   return raw.data;
  if (Array.isArray(raw.companies))              return raw.companies;
  if (raw.response && Array.isArray(raw.response.data)) return raw.response.data;
  if (raw.response && Array.isArray(raw.response.companies)) return raw.response.companies;
  return [];
}

// ─────────────────────────────────────────────
//  Helper : lire un champ imbriqué (a.b.c)
// ─────────────────────────────────────────────
function getVal(obj, ...keys) {
  for (const key of keys) {
    let val = obj;
    for (const part of key.split(".")) val = val?.[part];
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}

// ─────────────────────────────────────────────
//  Détection entreprise française
//  On cherche dans TOUS les champs liés au pays
// ─────────────────────────────────────────────
function isFrench(company) {
  const fields = [
    getVal(company, "country"),
    getVal(company, "country_name"),
    getVal(company, "country_code"),
    getVal(company, "profile.country"),
    getVal(company, "info.country"),
  ].filter(Boolean).map(v => String(v).toLowerCase().trim());

  return fields.some(f => FRENCH_COUNTRY_VALUES.includes(f));
}

// ─────────────────────────────────────────────
//  Récupération de TOUTES les entreprises
//  puis filtrage côté client sur pays = France
// ─────────────────────────────────────────────
async function getFrenchCompanies() {
  let page = 1;
  let allFrench = [];
  let hasMore = true;
  let firstItemKeys = null;

  console.log("[Trucky] Début de la récupération des entreprises...");

  while (hasMore) {
    try {
      // On essaie avec country=FR ET sans, selon la page
      const params = { page, limit: 50 };

      const response = await truckyApi.get("/companies", { params });
      const raw = response.data;
      const items = extractItems(raw);

      // Log de la structure au 1er appel pour debug
      if (page === 1) {
        firstItemKeys = items[0] ? Object.keys(items[0]) : [];
        console.log("[Trucky] Structure d'un item :", firstItemKeys.join(", "));
        if (items[0]) {
          const sample = {
            name: items[0].name,
            country: getVal(items[0], "country", "country_name", "country_code"),
            real_km: getVal(items[0], "real_km", "stats.real_km", "total_real_km", "distance_real"),
          };
          console.log("[Trucky] Exemple item:", JSON.stringify(sample));
        }
      }

      if (items.length === 0) {
        hasMore = false;
      } else {
        // Filtrage : on garde uniquement les entreprises françaises
        const french = items.filter(isFrench);
        allFrench = allFrench.concat(french);
        console.log(`[Trucky] Page ${page}: ${items.length} items, ${french.length} françaises (total: ${allFrench.length})`);

        if (items.length < 50 || page >= 30) hasMore = false;
        else page++;

        // Petite pause pour ne pas surcharger l'API
        if (hasMore) await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      const status = err.response?.status;
      console.error(`[Trucky] Erreur page ${page} (HTTP ${status || "?"}):`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Trucky] ✅ ${allFrench.length} entreprises françaises trouvées sur ${page} pages`);
  return allFrench;
}

// ─────────────────────────────────────────────
//  Formatage des nombres
// ─────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined) return "N/A";
  return Number(n).toLocaleString("fr-FR");
}

function fmtKm(km) {
  const v = Number(km);
  if (!km && km !== 0 || isNaN(v)) return "N/A";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M km`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)} k km`;
  return `${fmt(v)} km`;
}

function recruitLabel(company) {
  const v = getVal(company, "recruitment_status", "is_recruiting", "open_recruitment", "recruiting");
  if (v === null) return "";
  const s = String(v).toLowerCase();
  if (s === "open" || s === "true" || s === "1" || s === "yes") return "✅ Recrute";
  return "🔒 Fermé";
}

// ─────────────────────────────────────────────
//  Champs KM réels — l'API peut les nommer différemment
// ─────────────────────────────────────────────
function getKm(company) {
  return getVal(
    company,
    "real_km",
    "stats.real_km",
    "total_real_km",
    "distance_real",
    "km_real",
    "realKm",
    "stats.distance_real",
    "profile.real_km"
  );
}

function getMembers(company) {
  return getVal(company, "members_count", "members", "stats.members_count", "profile.members_count");
}

function getJobs(company) {
  return getVal(company, "jobs_count", "stats.jobs_count", "total_jobs", "deliveries_count");
}

// ─────────────────────────────────────────────
//  Construction de l'embed Discord
// ─────────────────────────────────────────────
function buildEmbed(companies) {
  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // Tri : si tous les KM sont null, on trie par membres
  const hasKmData = companies.some(c => getKm(c) !== null);
  const sorted = [...companies]
    .sort((a, b) => {
      if (hasKmData) return (getKm(b) ?? 0) - (getKm(a) ?? 0);
      return (getMembers(b) ?? 0) - (getMembers(a) ?? 0);
    })
    .slice(0, MAX_COMPANIES);

  // Totaux
  const totalKm      = companies.reduce((s, c) => s + (getKm(c) ?? 0), 0);
  const totalMembers = companies.reduce((s, c) => s + (getMembers(c) ?? 0), 0);
  const totalJobs    = companies.reduce((s, c) => s + (getJobs(c) ?? 0), 0);

  const sortLabel = hasKmData ? "KM réels" : "membres (KM non dispo)";

  const embed = new EmbedBuilder()
    .setTitle("🇫🇷  Statistiques des VTCs Françaises — Trucky Hub")
    .setColor(0x0055a4)
    .setDescription(
      `**${fmt(companies.length)}** entreprises françaises enregistrées sur Trucky\n\n` +
      `> 🛣️  **KM réels cumulés** : **${totalKm > 0 ? fmtKm(totalKm) : "Non disponible"}**\n` +
      `> 👥  **Membres totaux** : **${fmt(totalMembers)}**\n` +
      `> 📦  **Livraisons totales** : **${totalJobs > 0 ? fmt(totalJobs) : "Non disponible"}**`
    )
    .setFooter({ text: `Mise à jour : ${now}  •  hub.truckyapp.com` })
    .setTimestamp();

  // Classement
  if (sorted.length > 0) {
    const medals = ["🥇", "🥈", "🥉"];
    let board = "";

    sorted.forEach((c, i) => {
      const medal   = medals[i] ?? `**${i + 1}.**`;
      const name    = c.name ?? c.company_name ?? "Nom inconnu";
      const km      = getKm(c);
      const members = getMembers(c);
      const jobs    = getJobs(c);
      const recruit = recruitLabel(c);

      board += `${medal} **${name}**\n`;
      board += `　🛣️ ${km !== null ? fmtKm(km) : "—"}`;
      board += `  👥 ${members !== null ? fmt(members) + " membres" : "—"}`;
      if (jobs)    board += `  📦 ${fmt(jobs)}`;
      if (recruit) board += `  ${recruit}`;
      board += "\n\n";
    });

    embed.addFields({
      name: `🏆  Top ${sorted.length} VTCs françaises par ${sortLabel}`,
      value: board,
    });
  } else {
    embed.addFields({
      name: "ℹ️  Résultat",
      value: "Aucune entreprise française trouvée dans le directory Trucky.",
    });
  }

  embed.addFields({
    name: "🔗  Directory complet",
    value: "[hub.truckyapp.com/directory](https://hub.truckyapp.com/directory)",
    inline: true,
  });

  return embed;
}

// ─────────────────────────────────────────────
//  Bot Discord
// ─────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`[Discord] ✅ Connecté : ${client.user.tag}`);
  client.user.setActivity("les VTCs 🇫🇷", { type: ActivityType.Watching });
  sendStats();
  cron.schedule(STATS_INTERVAL, () => {
    console.log("[Cron] Déclenchement planifié");
    sendStats();
  });
});

async function sendStats() {
  console.log("[Bot] ─── Envoi des stats Trucky ───");
  const channel = await client.channels.fetch(CHANNEL_ID).catch(e => {
    console.error("[Discord] Salon introuvable :", e.message);
    return null;
  });
  if (!channel) return;

  let loadingMsg;
  try {
    loadingMsg = await channel.send({
      embeds: [new EmbedBuilder()
        .setDescription("⏳ Récupération des statistiques en cours…")
        .setColor(0xffa500)],
    });

    const companies = await getFrenchCompanies();

    if (!companies.length) {
      return loadingMsg.edit({
        embeds: [new EmbedBuilder()
          .setDescription(
            "⚠️ Aucune entreprise française trouvée.\n" +
            "L'API Trucky ne retourne peut-être pas le champ `country` sur cet endpoint public.\n" +
            "Vérifiez les logs Railway pour voir la structure des données."
          )
          .setColor(0xff8800)],
      });
    }

    await loadingMsg.edit({ embeds: [buildEmbed(companies)] });
    console.log(`[Bot] ✅ Stats envoyées (${companies.length} entreprises françaises)`);
  } catch (err) {
    console.error("[Bot] ❌ Erreur :", err.message);
    loadingMsg?.edit({
      embeds: [new EmbedBuilder()
        .setDescription(`❌ Erreur : ${err.message}`)
        .setColor(0xff0000)],
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
//  Vérifications au démarrage
// ─────────────────────────────────────────────
if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN manquant !");
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error("❌ CHANNEL_ID manquant !");
  process.exit(1);
}

client.login(DISCORD_TOKEN);

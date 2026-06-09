const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

// ─────────────────────────────────────────────
//  Configuration — via variables d'environnement
// ─────────────────────────────────────────────
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const CHANNEL_ID       = process.env.CHANNEL_ID;       // ID du salon Discord
const STATS_INTERVAL   = process.env.STATS_INTERVAL || "0 * * * *"; // toutes les heures
const MAX_COMPANIES    = parseInt(process.env.MAX_COMPANIES || "10");
const BOT_NAME         = process.env.BOT_NAME || "TruckyStatsBotFR"; // User-Agent API

// ─────────────────────────────────────────────
//  Client Trucky API
// ─────────────────────────────────────────────
const truckyApi = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 15000,
});

// ─────────────────────────────────────────────
//  Fonctions API
// ─────────────────────────────────────────────

async function getFrenchCompanies() {
  let page = 1;
  let allCompanies = [];
  let hasMore = true;
  console.log("[Trucky] Récupération des VTCs françaises...");

  while (hasMore) {
    try {
      const response = await truckyApi.get("/companies", {
        params: { country: "FR", page, limit: 50 },
      });
      const raw = response.data;
      const items =
        Array.isArray(raw) ? raw :
        Array.isArray(raw.response) ? raw.response :
        Array.isArray(raw.data) ? raw.data :
        Array.isArray(raw.companies) ? raw.companies :
        (raw.response && Array.isArray(raw.response.data)) ? raw.response.data : [];

      if (items.length === 0) {
        hasMore = false;
      } else {
        allCompanies = allCompanies.concat(items);
        if (items.length < 50 || page >= 20) hasMore = false;
        else page++;
      }
    } catch (err) {
      console.error(`[Trucky] Erreur page ${page}:`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Trucky] ${allCompanies.length} VTCs françaises trouvées`);
  return allCompanies;
}

// ─────────────────────────────────────────────
//  Helpers de formatage
// ─────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return "N/A";
  return Number(n).toLocaleString("fr-FR");
}

function fmtKm(km) {
  if (!km && km !== 0) return "N/A";
  const v = Number(km);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M km`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)} k km`;
  return `${fmt(v)} km`;
}

function recruitLabel(status) {
  if (status === undefined || status === null) return "";
  const s = String(status).toLowerCase();
  return (s === "open" || s === "true" || s === "1") ? "✅ Recrute" : "🔒 Fermé";
}

// ─────────────────────────────────────────────
//  Construction de l'embed Discord
// ─────────────────────────────────────────────

function buildEmbed(companies) {
  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // Récupération des champs selon différentes structures API possibles
  const getVal = (c, ...keys) => {
    for (const k of keys) {
      const parts = k.split(".");
      let val = c;
      for (const p of parts) val = val?.[p];
      if (val !== undefined && val !== null) return val;
    }
    return null;
  };

  // Tri par KM réels décroissants
  const sorted = [...companies]
    .sort((a, b) => {
      const ka = getVal(a, "real_km", "stats.real_km", "total_real_km") ?? 0;
      const kb = getVal(b, "real_km", "stats.real_km", "total_real_km") ?? 0;
      return kb - ka;
    })
    .slice(0, MAX_COMPANIES);

  // Totaux globaux
  const totalKm = companies.reduce((s, c) =>
    s + (getVal(c, "real_km", "stats.real_km", "total_real_km") ?? 0), 0);
  const totalMembers = companies.reduce((s, c) =>
    s + (getVal(c, "members_count", "members", "stats.members_count") ?? 0), 0);
  const totalJobs = companies.reduce((s, c) =>
    s + (getVal(c, "jobs_count", "stats.jobs_count", "total_jobs") ?? 0), 0);

  const embed = new EmbedBuilder()
    .setTitle("🇫🇷  Statistiques des VTCs Françaises — Trucky Hub")
    .setColor(0x0055a4)
    .setDescription(
      `**${fmt(companies.length)}** entreprises françaises sur Trucky\n\n` +
      `> 🛣️  **KM réels cumulés** : **${fmtKm(totalKm)}**\n` +
      `> 👥  **Membres** : **${fmt(totalMembers)}**\n` +
      `> 📦  **Livraisons** : **${fmt(totalJobs)}**`
    )
    .setFooter({ text: `Mise à jour : ${now}  •  hub.truckyapp.com` })
    .setTimestamp();

  // Classement top N
  if (sorted.length > 0) {
    const medals = ["🥇", "🥈", "🥉"];
    let board = "";
    sorted.forEach((c, i) => {
      const medal   = medals[i] ?? `**${i + 1}.**`;
      const name    = c.name ?? "Nom inconnu";
      const km      = getVal(c, "real_km", "stats.real_km", "total_real_km");
      const members = getVal(c, "members_count", "members", "stats.members_count");
      const jobs    = getVal(c, "jobs_count", "stats.jobs_count", "total_jobs");
      const recruit = getVal(c, "recruitment_status", "is_recruiting", "open_recruitment");
      const rLabel  = recruitLabel(recruit);

      board += `${medal} **${name}**\n`;
      board += `　🛣️ ${fmtKm(km)}  👥 ${fmt(members)} membres`;
      if (jobs) board += `  📦 ${fmt(jobs)} jobs`;
      if (rLabel) board += `  ${rLabel}`;
      board += "\n\n";
    });

    embed.addFields({
      name: `🏆  Top ${sorted.length} VTCs par KM réels`,
      value: board,
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
  console.log(`[Discord] Connecté : ${client.user.tag}`);
  client.user.setActivity("les VTCs 🇫🇷", { type: ActivityType.Watching });

  sendStats(); // envoi immédiat au démarrage

  cron.schedule(STATS_INTERVAL, () => {
    console.log("[Cron] Déclenchement planifié");
    sendStats();
  });
});

async function sendStats() {
  console.log("[Bot] Envoi des stats Trucky...");

  const channel = await client.channels.fetch(CHANNEL_ID).catch((e) => {
    console.error("[Discord] Salon introuvable :", e.message);
    return null;
  });
  if (!channel) return;

  let loadingMsg;
  try {
    loadingMsg = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setDescription("⏳ Récupération des statistiques en cours…")
          .setColor(0xffa500),
      ],
    });

    const companies = await getFrenchCompanies();

    if (!companies.length) {
      return loadingMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setDescription("❌ Aucune donnée disponible depuis l'API Trucky.")
            .setColor(0xff0000),
        ],
      });
    }

    await loadingMsg.edit({ embeds: [buildEmbed(companies)] });
    console.log("[Bot] Stats envoyées ✓");
  } catch (err) {
    console.error("[Bot] Erreur :", err.message);
    if (loadingMsg) {
      loadingMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setDescription(`❌ Erreur : ${err.message}`)
            .setColor(0xff0000),
        ],
      }).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────
//  Démarrage
// ─────────────────────────────────────────────
if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN manquant ! Ajoutez la variable dans Railway.");
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error("❌ CHANNEL_ID manquant ! Ajoutez la variable dans Railway.");
  process.exit(1);
}

client.login(DISCORD_TOKEN);

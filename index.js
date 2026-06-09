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
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const STATS_INTERVAL = process.env.STATS_INTERVAL || "0 * * * *";
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "30");
const BOT_NAME       = process.env.BOT_NAME || "TruckyStatsBotFR";

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
//  Helpers d'extraction de données
// ─────────────────────────────────────────────
function extractItems(raw) {
  if (Array.isArray(raw))                                      return raw;
  if (Array.isArray(raw.response))                             return raw.response;
  if (Array.isArray(raw.data))                                 return raw.data;
  if (Array.isArray(raw.companies))                            return raw.companies;
  if (raw.response?.data && Array.isArray(raw.response.data)) return raw.response.data;
  return [];
}

const getVal = (c, ...keys) => {
  for (const k of keys) {
    const parts = k.split(".");
    let val = c;
    for (const p of parts) val = val?.[p];
    if (val !== undefined && val !== null) return val;
  }
  return null;
};

// ─────────────────────────────────────────────
//  Récupération du leaderboard France
//  Essaie plusieurs endpoints dans l'ordre
// ─────────────────────────────────────────────
async function getFrenchLeaderboard() {
  console.log("[Trucky] Récupération du leaderboard France...");

  // ── Tentative 1 : endpoint leaderboard avec filtre pays ──
  const leaderboardEndpoints = [
    { path: "/leaderboards/companies", params: { country_code: "FR", game: "ets2", limit: MAX_COMPANIES } },
    { path: "/leaderboards/companies", params: { country: "FR", game: "ets2", limit: MAX_COMPANIES } },
    { path: "/leaderboards",           params: { country: "FR", game: "ets2", type: "km", limit: MAX_COMPANIES } },
    { path: "/leaderboards/distance",  params: { country_code: "FR", limit: MAX_COMPANIES } },
  ];

  for (const { path, params } of leaderboardEndpoints) {
    try {
      const r = await truckyApi.get(path, { params });
      const items = extractItems(r.data);
      if (items.length > 0) {
        console.log(`[Trucky] ✅ Leaderboard via ${path} — ${items.length} VTCs`);
        return { items, source: "leaderboard" };
      }
    } catch (err) {
      console.warn(`[Trucky] ⚠️  ${path} → ${err.response?.status ?? err.message}`);
    }
  }

  // ── Tentative 2 : fallback — companies françaises paginées, tri manuel ──
  console.log("[Trucky] Fallback : récupération paginée des companies FR...");
  let page = 1;
  let allCompanies = [];
  let hasMore = true;

  while (hasMore) {
    try {
      const r = await truckyApi.get("/companies", {
        params: { country: "FR", page, limit: 50 },
      });
      const items = extractItems(r.data);
      if (items.length === 0) { hasMore = false; break; }
      allCompanies = allCompanies.concat(items);
      if (items.length < 50 || page >= 20) hasMore = false;
      else page++;
    } catch (err) {
      console.error(`[Trucky] Erreur page ${page}:`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Trucky] Fallback — ${allCompanies.length} VTCs françaises récupérées`);

  // Tri par KM réels décroissants
  const sorted = allCompanies.sort((a, b) => {
    const ka = getVal(a, "real_km", "stats.real_km", "total_real_km", "km") ?? 0;
    const kb = getVal(b, "real_km", "stats.real_km", "total_real_km", "km") ?? 0;
    return kb - ka;
  });

  return { items: sorted, source: "companies" };
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
  return (s === "open" || s === "true" || s === "1") ? "✅" : "🔒";
}

// ─────────────────────────────────────────────
//  Construction de l'embed Discord
// ─────────────────────────────────────────────
function buildEmbed(items, source) {
  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const top = items.slice(0, MAX_COMPANIES);

  // Totaux (sur tout ce qui a été récupéré)
  const totalKm = items.reduce((s, c) =>
    s + (getVal(c, "real_km", "stats.real_km", "total_real_km", "km") ?? 0), 0);
  const totalMembers = items.reduce((s, c) =>
    s + (getVal(c, "members_count", "members", "stats.members_count") ?? 0), 0);

  const embed = new EmbedBuilder()
    .setTitle("🇫🇷  Top " + MAX_COMPANIES + " VTCs Françaises — Trucky Hub")
    .setColor(0x0055a4)
    .setFooter({
      text: `Mise à jour : ${now}  •  hub.truckyapp.com  •  source: ${source}`,
    })
    .setTimestamp();

  // Résumé global (uniquement si fallback avec toutes les VTCs)
  if (source === "companies" && items.length > MAX_COMPANIES) {
    embed.setDescription(
      `**${fmt(items.length)}** VTCs françaises sur Trucky\n` +
      `> 🛣️  KM réels cumulés : **${fmtKm(totalKm)}**\n` +
      `> 👥  Membres : **${fmt(totalMembers)}**`
    );
  }

  // Classement
  const medals = ["🥇", "🥈", "🥉"];
  let board = "";

  top.forEach((c, i) => {
    const medal   = medals[i] ?? `\`${String(i + 1).padStart(2)}\``;
    const name    = c.name ?? c.company_name ?? "Nom inconnu";
    const km      = getVal(c, "real_km", "stats.real_km", "total_real_km", "km", "distance");
    const members = getVal(c, "members_count", "members", "stats.members_count");
    const recruit = getVal(c, "recruitment", "is_recruiting", "open_recruitment", "recruitment_status");
    const rLabel  = recruitLabel(recruit);

    board += `${medal} **${name}**`;
    if (rLabel) board += ` ${rLabel}`;
    board += "\n";

    const details = [];
    if (km      !== null) details.push(`🛣️ ${fmtKm(km)}`);
    if (members !== null) details.push(`👥 ${fmt(members)}`);
    if (details.length)   board += `　${details.join("  ")}\n`;

    board += "\n";
  });

  // Discord limite les fields à 1024 chars — on découpe si nécessaire
  const CHUNK = 1024;
  if (board.length <= CHUNK) {
    embed.addFields({ name: `🏆  Classement Top ${top.length}`, value: board });
  } else {
    // Découpe en 2 colonnes (1–15 et 16–30)
    const lines = board.split("\n\n").filter(Boolean);
    const mid   = Math.ceil(lines.length / 2);
    embed.addFields(
      { name: `🏆  Top ${mid}`, value: lines.slice(0, mid).join("\n\n") + "\n", inline: true },
      { name: `🏆  ${mid + 1}–${top.length}`, value: lines.slice(mid).join("\n\n") + "\n", inline: true }
    );
  }

  embed.addFields({
    name: "🔗  Leaderboard complet",
    value: "[hub.truckyapp.com/leaderboards](https://hub.truckyapp.com/leaderboards)",
    inline: false,
  });

  return embed;
}

// ─────────────────────────────────────────────
//  Bot Discord
// ─────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`[Discord] Connecté : ${client.user.tag}`);
  client.user.setActivity("le Top 30 🇫🇷", { type: ActivityType.Watching });

  sendStats();

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
          .setDescription("⏳ Récupération du classement en cours…")
          .setColor(0xffa500),
      ],
    });

    const { items, source } = await getFrenchLeaderboard();

    if (!items.length) {
      return loadingMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setDescription("❌ Aucune donnée disponible depuis l'API Trucky.")
            .setColor(0xff0000),
        ],
      });
    }

    await loadingMsg.edit({ embeds: [buildEmbed(items, source)] });
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
  console.error("❌ DISCORD_TOKEN manquant !");
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error("❌ CHANNEL_ID manquant !");
  process.exit(1);
}

client.login(DISCORD_TOKEN);

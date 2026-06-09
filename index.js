const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const STATS_INTERVAL = process.env.STATS_INTERVAL || "0 * * * *";
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "30");
const BOT_NAME       = process.env.BOT_NAME || "TruckyStatsBotFR";

const truckyApi = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 15000,
});

async function getFrenchLeaderboard() {
  console.log("[Trucky] Récupération users leaderboard France...");

  let allUsers = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 20) {
    try {
      const r = await truckyApi.get("/users/leaderboards", {
        params: {
          period:  "monthly",
          game:    "",
          name:    "",
          country: "france",
          page,
          perPage: 50,
        },
      });

      const raw   = r.data;
      const items = extractItems(raw);
      console.log(`[Trucky] Page ${page} — ${items.length} users`);

      if (items.length === 0) { hasMore = false; break; }

      if (page === 1 && items[0]) {
        console.log("[Trucky] Clés user[0]:", Object.keys(items[0]).join(", "));
        console.log("[Trucky] user[0]:", JSON.stringify(items[0]).slice(0, 500));
      }

      allUsers = allUsers.concat(items);

      const total = raw.total ?? raw.meta?.total ?? raw.data?.total ?? null;
      if (total && allUsers.length >= total) hasMore = false;
      else if (items.length < 50) hasMore = false;
      else page++;

    } catch (err) {
      console.error(`[Trucky] Erreur page ${page}:`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Trucky] Total users français : ${allUsers.length}`);
  if (allUsers.length === 0) return [];

  const companyMap = {};

  for (const user of allUsers) {
    const companyName =
      user.company?.name ??
      user.vtc?.name ??
      user.company_name ??
      user.vtc_name ??
      null;

    if (!companyName) continue;

    const companyId =
      user.company?.id ??
      user.vtc?.id ??
      user.company_id ??
      user.vtc_id ??
      companyName;

    if (!companyMap[companyId]) {
      companyMap[companyId] = { name: companyName, km: 0, members: 0 };
    }

    const userKm =
      user.real_km ??
      user.km ??
      user.distance ??
      user.total_km ??
      user.driven_km ??
      user.stats?.real_km ??
      user.stats?.km ??
      0;

    companyMap[companyId].km      += Number(userKm) || 0;
    companyMap[companyId].members += 1;
  }

  const sorted = Object.values(companyMap)
    .sort((a, b) => b.km - a.km)
    .slice(0, MAX_COMPANIES);

  console.log(`[Trucky] ${sorted.length} VTCs françaises trouvées`);
  if (sorted[0]) console.log(`[Trucky] #1 : ${sorted[0].name} — ${sorted[0].km} km`);

  return sorted;
}

function extractItems(raw) {
  if (Array.isArray(raw))                             return raw;
  if (Array.isArray(raw.data))                        return raw.data;
  if (raw.data?.data && Array.isArray(raw.data.data)) return raw.data.data;
  if (Array.isArray(raw.response))                    return raw.response;
  if (Array.isArray(raw.items))                       return raw.items;
  if (Array.isArray(raw.users))                       return raw.users;
  return [];
}

function fmtKm(v) {
  if (!v && v !== 0) return null;
  const n = Number(v);
  if (isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M km`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} k km`;
  return `${n.toLocaleString("fr-FR")} km`;
}

function fmtNum(v) {
  const n = Number(v);
  return (!v || isNaN(n) || n === 0) ? null : n.toLocaleString("fr-FR");
}

function buildEmbed(companies) {
  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const medals = ["🥇", "🥈", "🥉"];
  let board = "";

  companies.forEach((c, i) => {
    const medal   = medals[i] ?? `\`${String(i + 1).padStart(2)}\``;
    const km      = fmtKm(c.km);
    const members = fmtNum(c.members);

    board += `${medal} **${c.name}**\n`;
    const details = [];
    if (km)      details.push(`🛣️ ${km}`);
    if (members) details.push(`👥 ${members}`);
    if (details.length) board += `　${details.join("  ")}\n`;
    board += "\n";
  });

  if (!board.trim()) board = "Aucune donnée disponible.";

  const embed = new EmbedBuilder()
    .setTitle(`🇫🇷  Top ${companies.length} VTCs Françaises — Trucky Hub`)
    .setColor(0x0055a4)
    .setTimestamp()
    .setFooter({ text: `Mise à jour : ${now}  •  classement mensuel  •  hub.truckyapp.com` });

  if (board.length <= 1000) {
    embed.addFields({ name: "🏆  Classement du mois", value: board });
  } else {
    const lines = board.split("\n\n").filter(Boolean);
    const mid   = Math.ceil(lines.length / 2);
    embed.addFields(
      { name: `🏆  #1 – ${mid}`,                   value: lines.slice(0, mid).join("\n\n") + "\n", inline: true },
      { name: `🏆  #${mid + 1} – ${lines.length}`, value: lines.slice(mid).join("\n\n")   + "\n", inline: true }
    );
  }

  embed.addFields({
    name:  "🔗  Leaderboard complet",
    value: "[hub.truckyapp.com/leaderboards](https://hub.truckyapp.com/leaderboards)",
  });

  return embed;
}

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
          .setDescription("⏳ Récupération du classement France en cours…")
          .setColor(0xffa500),
      ],
    });

    const companies = await getFrenchLeaderboard();

    if (!companies.length) {
      return loadingMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setDescription("❌ Aucune donnée disponible. Vérifiez les logs Railway.")
            .setColor(0xff0000),
        ],
      });
    }

    await loadingMsg.edit({ embeds: [buildEmbed(companies)] });
    console.log(`[Bot] ✅ ${companies.length} VTCs affichées`);

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

if (!DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN manquant !"); process.exit(1); }
if (!CHANNEL_ID)    { console.error("❌ CHANNEL_ID manquant !");    process.exit(1); }
client.login(DISCORD_TOKEN);

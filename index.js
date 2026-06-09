const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const STATS_INTERVAL = process.env.STATS_INTERVAL || "*/30 * * * *"; // toutes les 30 min
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "18");
const BOT_NAME       = process.env.BOT_NAME || "TruckyStatsBotFR";
const STATS_TYPE     = process.env.STATS_TYPE || "real_miles"; // real_miles | driven_miles
const GAME           = process.env.GAME || "1";                // 1=ETS2 2=ATS
// ─────────────────────────────────────────────────────────────────────────────

const truckyApi = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 15000,
});

// Récupère le leaderboard entreprises FR directement depuis l'endpoint dédié
async function getCompaniesLeaderboard() {
  const now = new Date();
  console.log("[Trucky] Récupération leaderboard entreprises FR...");

  try {
    const r = await truckyApi.get("/companies/leaderboards", {
      params: {
        name:         "",
        country_code: "FR",
        company_type: "",
        language:     "",
        recruitment:  "",
        game:         GAME,
        stats_type:   STATS_TYPE,
        month:        now.getMonth() + 1,
        year:         now.getFullYear(),
        page:         1,
        perPage:      MAX_COMPANIES,
      },
    });

    const items = extractItems(r.data);
    console.log(`[Trucky] ${items.length} entreprises reçues`);
    if (items[0]) {
      console.log("[Trucky] Clés company[0]:", Object.keys(items[0]).join(", "));
      console.log("[Trucky] company[0] complet:", JSON.stringify(items[0], null, 2));
      // Log spécifique des stats pour débug
      if (items[0].stats) {
        console.log("[Trucky] stats keys:", Object.keys(items[0].stats).join(", "));
        console.log("[Trucky] stats values:", JSON.stringify(items[0].stats));
      }
    }
    return items;

  } catch (err) {
    console.error("[Trucky] Erreur API :", err.message);
    return [];
  }
}

function extractItems(raw) {
  if (Array.isArray(raw))                             return raw;
  if (Array.isArray(raw.response))                    return raw.response;
  if (Array.isArray(raw.data))                        return raw.data;
  if (raw.data?.data && Array.isArray(raw.data.data)) return raw.data.data;
  if (Array.isArray(raw.items))                       return raw.items;
  return [];
}

// Normalise les miles/km selon la clé retournée par l'API
// Tente toutes les variantes connues, puis fallback sur la première valeur numérique > 0
function getDistance(company) {
  const stats = company.stats ?? {};

  const candidates = [
    stats[STATS_TYPE], stats.real_miles, stats.driven_miles,
    stats.total_miles, stats.miles, stats.real_km,
    stats.driven_km,   stats.total_km,  stats.km, stats.distance,
    company[STATS_TYPE], company.real_miles, company.driven_miles,
    company.total_miles, company.miles, company.real_km,
    company.driven_km,   company.total_km,  company.km, company.distance,
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n;
  }

  // Dernier recours : première valeur numérique > 0 dans stats
  for (const v of Object.values(stats)) {
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n;
  }

  return 0;
}

function getMembers(company) {
  return (
    company.members_count ??
    company.members       ??
    company.drivers_count ??
    null
  );
}

function fmtDist(v) {
  const n = Number(v);
  if (!n || isNaN(n)) return null;
  const label = STATS_TYPE.includes("km") ? "km" : "mi";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M ${label}`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} k ${label}`;
  return `${n.toLocaleString("fr-FR")} ${label}`;
}

function fmtNum(v) {
  const n = Number(v);
  return (!v || isNaN(n) || n === 0) ? null : n.toLocaleString("fr-FR");
}

function gameLabel()  { return GAME === "2" ? "ATS" : "ETS2"; }
function statsLabel() { return STATS_TYPE === "driven_miles" ? "Miles totaux" : "Miles réels"; }

function buildEmbed(companies) {
  const now = new Date();
  const dateFR = now.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const moisFR = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const medals = ["🥇", "🥈", "🥉"];
  let board = "";

  companies.forEach((c, i) => {
    const rank    = c.position ?? c.rank ?? (i + 1);
    const medal   = medals[i] ?? `\`#${String(rank).padStart(2, "0")}\``;
    const dist    = fmtDist(getDistance(c));
    const members = fmtNum(getMembers(c));
    const tag     = c.tag ? ` [${c.tag}]` : "";

    board += `${medal} **${c.name}**${tag}\n`;
    const details = [];
    if (dist)    details.push(`🛣️ ${dist}`);
    if (members) details.push(`👥 ${members}`);
    if (details.length) board += `　${details.join("  ")}\n`;
    board += "\n";
  });

  if (!board.trim()) board = "Aucune donnée disponible.";

  const embed = new EmbedBuilder()
    .setTitle(`🇫🇷  Top ${companies.length} VTCs Françaises — ${moisFR}`)
    .setDescription(`**Jeu :** ${gameLabel()} · **Stats :** ${statsLabel()}`)
    .setColor(0x0055a4)
    .setTimestamp()
    .setFooter({ text: `Màj : ${dateFR}  •  toutes les 30 min  •  Trucky API` });

  if (board.length <= 1000) {
    embed.addFields({ name: "🏆  Classement du mois", value: board });
  } else {
    const lines = board.split("\n\n").filter(Boolean);
    const mid   = Math.ceil(lines.length / 2);
    embed.addFields(
      { name: `🏆  #1 – #${mid}`,                    value: lines.slice(0, mid).join("\n\n") + "\n", inline: true },
      { name: `🏆  #${mid + 1} – #${lines.length}`,  value: lines.slice(mid).join("\n\n")   + "\n", inline: true }
    );
  }

  embed.addFields({
    name:  "🔗  Leaderboard complet",
    value: "[hub.truckyapp.com/leaderboards](https://hub.truckyapp.com/leaderboards)",
  });

  return embed;
}

// ─── Discord ──────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let cachedMessageId = null; // édite le même message plutôt que de spammer

client.once("ready", () => {
  console.log(`[Discord] Connecté : ${client.user.tag}`);
  client.user.setActivity("le Top FR 🇫🇷", { type: ActivityType.Watching });
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
    // Essaie d'éditer le message précédent, sinon en crée un nouveau
    if (cachedMessageId) {
      try {
        loadingMsg = await channel.messages.fetch(cachedMessageId);
        await loadingMsg.edit({
          embeds: [
            new EmbedBuilder()
              .setDescription("⏳ Mise à jour du classement en cours…")
              .setColor(0xffa500),
          ],
        });
      } catch {
        cachedMessageId = null;
        loadingMsg = null;
      }
    }

    if (!loadingMsg) {
      loadingMsg = await channel.send({
        embeds: [
          new EmbedBuilder()
            .setDescription("⏳ Récupération du classement France en cours…")
            .setColor(0xffa500),
        ],
      });
      cachedMessageId = loadingMsg.id;
    }

    const companies = await getCompaniesLeaderboard();

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

// ─── Démarrage ────────────────────────────────────────────────────────────────
if (!DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN manquant !"); process.exit(1); }
if (!CHANNEL_ID)    { console.error("❌ CHANNEL_ID manquant !");    process.exit(1); }
client.login(DISCORD_TOKEN);

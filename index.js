const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const STATS_INTERVAL = process.env.STATS_INTERVAL || "0 * * * *";
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "10");
const BOT_NAME       = process.env.BOT_NAME || "TruckyStatsBotFR";

// ────────────────────────────────────────────────────────────
// CLIENT API
// ────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 20000,
});

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────
function extractItems(raw) {
  if (Array.isArray(raw))                   return raw;
  if (Array.isArray(raw?.response))         return raw.response;
  if (Array.isArray(raw?.data))             return raw.data;
  if (Array.isArray(raw?.companies))        return raw.companies;
  if (Array.isArray(raw?.response?.data))   return raw.response.data;
  // Cherche le premier tableau dans l'objet
  for (const v of Object.values(raw || {})) {
    if (Array.isArray(v) && v.length > 0) return v;
  }
  return [];
}

function deepGet(obj, ...paths) {
  for (const path of paths) {
    let v = obj;
    for (const k of path.split(".")) v = v?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// Cherche "france" ou "fr" dans N'IMPORTE QUEL champ de l'objet (récursif)
function containsFrance(obj, depth = 0) {
  if (depth > 4 || obj === null || obj === undefined) return false;
  if (typeof obj === "string") {
    const s = obj.toLowerCase().trim();
    return s === "france" || s === "fr" || s === "fra" || s === "french" ||
           s.includes("france") || (s.length === 2 && s === "fr");
  }
  if (typeof obj === "number") return false;
  if (Array.isArray(obj)) return obj.some(v => containsFrance(v, depth + 1));
  if (typeof obj === "object") return Object.values(obj).some(v => containsFrance(v, depth + 1));
  return false;
}

function getKm(c) {
  return deepGet(c,
    "real_km","realKm","real_distance","distance_real","km_real",
    "stats.real_km","stats.realKm","stats.real_distance","stats.distance_real",
    "total_real_km","profile.real_km","summary.real_km",
    "monthly_stats.real_km","alltime_stats.real_km"
  );
}
function getMembers(c) {
  return deepGet(c,"members_count","members","membersCount","stats.members_count","profile.members_count");
}
function getJobs(c) {
  return deepGet(c,"jobs_count","jobsCount","stats.jobs_count","total_jobs","deliveries_count");
}
function getName(c) {
  return deepGet(c,"name","company_name","companyName","title") ?? "Inconnu";
}

function fmt(n) {
  if (n === null || n === undefined) return "N/A";
  return Number(n).toLocaleString("fr-FR");
}
function fmtKm(v) {
  const n = Number(v);
  if (!v && v !== 0 || isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M km`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} k km`;
  return `${fmt(n)} km`;
}
function recruit(c) {
  const v = deepGet(c,"recruitment_status","is_recruiting","open_recruitment","recruiting","recruitment");
  if (v === null) return "";
  return ["open","true","1","yes","ouvert"].includes(String(v).toLowerCase()) ? "✅ Recrute" : "🔒 Fermé";
}

// ────────────────────────────────────────────────────────────
// RÉCUPÉRATION TOUTES PAGES
// ────────────────────────────────────────────────────────────
async function fetchAllCompanies() {
  let page = 1, all = [], hasMore = true;
  while (hasMore) {
    try {
      const r = await api.get("/companies", { params: { page, limit: 50 } });
      const items = extractItems(r.data);
      console.log(`[API] Page ${page} → ${items.length} items`);
      if (!items.length) { hasMore = false; break; }
      all = all.concat(items);
      if (items.length < 50 || page >= 30) hasMore = false;
      else { page++; await sleep(300); }
    } catch (e) {
      console.error(`[API] Erreur page ${page}:`, e.response?.status, e.message);
      hasMore = false;
    }
  }
  return all;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────────────────────────────────────────
// ENVOI DES STATS
// ────────────────────────────────────────────────────────────
async function sendStats(channel) {
  let msg = await channel.send({
    embeds: [new EmbedBuilder().setDescription("⏳ Récupération des données Trucky…").setColor(0xffa500)]
  });

  const all = await fetchAllCompanies();
  if (!all.length) {
    return msg.edit({ embeds: [new EmbedBuilder()
      .setDescription("❌ L'API Trucky n'a retourné aucune donnée.")
      .setColor(0xff0000)] });
  }

  // LOG de la structure du 1er item pour Railway
  const first = all[0];
  const allKeys = Object.keys(first);
  console.log("[STRUCTURE] Clés item:", allKeys.join(", "));
  const countryKeys = allKeys.filter(k => /country|nation|pays|location|lang/i.test(k));
  countryKeys.forEach(k => console.log(`[STRUCTURE] ${k} =`, JSON.stringify(first[k])));
  console.log("[STRUCTURE] Exemple item complet:", JSON.stringify(first).slice(0, 500));

  // Filtrer les entreprises françaises
  const french = all.filter(c => containsFrance(c));
  console.log(`[FILTRE] ${french.length} / ${all.length} entreprises françaises`);

  // Si toujours 0, envoyer un message de diagnostic dans Discord
  if (!french.length) {
    // Chercher des indices sur le champ pays
    const sampleValues = countryKeys.flatMap(k => all.slice(0, 5).map(c => `${k}=${JSON.stringify(c[k])}`));
    const diag = [
      `**Total entreprises récupérées :** ${all.length}`,
      `**Entreprises françaises trouvées :** 0`,
      "",
      `**Champs liés au pays dans l'API :**`,
      countryKeys.length
        ? countryKeys.map(k => `\`${k}\` = \`${JSON.stringify(first[k])}\``).join("\n")
        : "_(aucun champ 'country' détecté)_",
      "",
      `**Clés disponibles :**`,
      `\`${allKeys.join(", ")}\``,
      "",
      `**5 premiers noms :**`,
      all.slice(0, 5).map((c, i) => `${i+1}. ${getName(c)}`).join("\n"),
    ].join("\n");

    return msg.edit({ embeds: [new EmbedBuilder()
      .setTitle("🔍 Diagnostic API Trucky")
      .setDescription(diag.slice(0, 4096))
      .setColor(0xff8800)
      .setFooter({ text: "Transmets ce message à Claude pour corriger le filtre" })] });
  }

  // Construire l'embed de stats
  const hasKm = french.some(c => getKm(c) !== null);
  const sorted = [...french]
    .sort((a, b) => hasKm ? (getKm(b)??0)-(getKm(a)??0) : (getMembers(b)??0)-(getMembers(a)??0))
    .slice(0, MAX_COMPANIES);

  const totalKm  = french.reduce((s, c) => s + (getKm(c)??0), 0);
  const totalMbr = french.reduce((s, c) => s + (getMembers(c)??0), 0);
  const totalJob = french.reduce((s, c) => s + (getJobs(c)??0), 0);

  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const embed = new EmbedBuilder()
    .setTitle("🇫🇷  Statistiques des VTCs Françaises — Trucky Hub")
    .setColor(0x0055a4)
    .setDescription(
      `**${fmt(french.length)}** entreprises françaises enregistrées sur Trucky\n\n` +
      `> 🛣️  **KM réels** : **${totalKm > 0 ? fmtKm(totalKm) : "Non disponible"}**\n` +
      `> 👥  **Membres** : **${fmt(totalMbr)}**\n` +
      `> 📦  **Livraisons** : **${totalJob > 0 ? fmt(totalJob) : "Non disponible"}**`
    )
    .setFooter({ text: `Mise à jour : ${now}  •  hub.truckyapp.com` })
    .setTimestamp();

  const medals = ["🥇","🥈","🥉"];
  let board = "";
  sorted.forEach((c, i) => {
    const km  = getKm(c);
    const mbr = getMembers(c);
    const job = getJobs(c);
    const rec = recruit(c);
    board += `${medals[i] ?? `**${i+1}.**`} **${getName(c)}**\n`;
    board += `　🛣️ ${km !== null ? fmtKm(km) : "—"}  👥 ${mbr !== null ? fmt(mbr)+" mbr" : "—"}`;
    if (job) board += `  📦 ${fmt(job)}`;
    if (rec) board += `  ${rec}`;
    board += "\n\n";
  });

  if (board) embed.addFields({
    name: `🏆  Top ${sorted.length} VTCs par ${hasKm ? "KM réels" : "membres"}`,
    value: board
  });
  embed.addFields({
    name: "🔗  Directory complet",
    value: "[hub.truckyapp.com/directory](https://hub.truckyapp.com/directory)",
    inline: true
  });

  await msg.edit({ embeds: [embed] });
  console.log(`[BOT] ✅ Stats envoyées — ${french.length} VTCs françaises`);
}

// ────────────────────────────────────────────────────────────
// BOT DISCORD
// ────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`[Discord] ✅ Connecté : ${client.user.tag}`);
  client.user.setActivity("les VTCs 🇫🇷", { type: ActivityType.Watching });

  const channel = await client.channels.fetch(CHANNEL_ID).catch(e => {
    console.error("[Discord] Salon introuvable:", e.message); return null;
  });
  if (!channel) return;

  // Premier envoi immédiat
  sendStats(channel).catch(e => console.error("[BOT] Erreur:", e.message));

  // Envoi périodique
  cron.schedule(STATS_INTERVAL, () => {
    console.log("[CRON] Déclenchement");
    sendStats(channel).catch(e => console.error("[BOT] Erreur cron:", e.message));
  });
});

if (!DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN manquant"); process.exit(1); }
if (!CHANNEL_ID)    { console.error("❌ CHANNEL_ID manquant");    process.exit(1); }

client.login(DISCORD_TOKEN);

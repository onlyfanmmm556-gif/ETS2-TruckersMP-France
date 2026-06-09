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
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "10");
const BOT_NAME       = process.env.BOT_NAME || "TruckyStatsBotFR";
const DEBUG_MODE     = process.env.DEBUG_MODE === "true"; // mettre true pour voir la structure

const truckyApi = axios.create({
  baseURL: "https://e.truckyapp.com/api/v1",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BOT_NAME,
  },
  timeout: 20000,
});

// ─── Extraction des items selon la structure retournée ───
function extractItems(raw) {
  if (Array.isArray(raw))                              return raw;
  if (Array.isArray(raw.response))                     return raw.response;
  if (Array.isArray(raw.data))                         return raw.data;
  if (Array.isArray(raw.companies))                    return raw.companies;
  if (raw.response?.data && Array.isArray(raw.response.data))   return raw.response.data;
  if (raw.response?.companies && Array.isArray(raw.response.companies)) return raw.response.companies;
  return [];
}

// ─── Lire un champ potentiellement imbriqué ───
function getVal(obj, ...keys) {
  for (const key of keys) {
    let val = obj;
    for (const part of key.split(".")) val = val?.[part];
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}

// ─── Champs KM réels (tous les noms possibles) ───
function getKm(c) {
  return getVal(c,
    "real_km", "realKm", "real_distance",
    "stats.real_km", "stats.realKm", "stats.real_distance",
    "total_real_km", "distance_real", "km_real",
    "profile.real_km", "summary.real_km"
  );
}

function getMembers(c) {
  return getVal(c, "members_count", "members", "stats.members_count", "profile.members_count", "membersCount");
}

function getJobs(c) {
  return getVal(c, "jobs_count", "stats.jobs_count", "total_jobs", "deliveries_count", "jobsCount");
}

// ─── Détection France : cherche dans TOUS les champs de l'objet ───
function isFrench(company) {
  // Valeurs reconnues comme "France"
  const FR_VALUES = ["france", "fr", "french", "fra", "france (fr)"];
  
  // On cherche dans toutes les clés de l'objet (pas seulement "country")
  function searchInObject(obj, depth = 0) {
    if (depth > 3 || !obj || typeof obj !== "object") return false;
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string") {
        const lower = val.toLowerCase().trim();
        if (FR_VALUES.includes(lower)) return true;
        // Si la clé contient "country" ou "nation", on est plus souple
        if ((key.toLowerCase().includes("country") || key.toLowerCase().includes("nation")) 
            && lower.includes("fr")) return true;
      } else if (typeof val === "object" && val !== null) {
        if (searchInObject(val, depth + 1)) return true;
      }
    }
    return false;
  }
  
  return searchInObject(company);
}

// ─── Formatage ───
function fmt(n) {
  if (n === null || n === undefined) return "N/A";
  return Number(n).toLocaleString("fr-FR");
}
function fmtKm(km) {
  const v = Number(km);
  if (!km && km !== 0 || isNaN(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M km`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)} k km`;
  return `${fmt(v)} km`;
}
function recruitLabel(c) {
  const v = getVal(c, "recruitment_status", "is_recruiting", "open_recruitment", "recruiting", "recruitment");
  if (v === null) return "";
  const s = String(v).toLowerCase();
  return (s === "open" || s === "true" || s === "1" || s === "yes") ? "✅ Recrute" : "🔒 Fermé";
}

// ─── Récupère toutes les pages ───
async function getAllCompanies() {
  let page = 1, all = [], hasMore = true;
  while (hasMore) {
    try {
      const r = await truckyApi.get("/companies", { params: { page, limit: 50 } });
      const items = extractItems(r.data);
      if (!items.length) { hasMore = false; break; }
      all = all.concat(items);
      console.log(`[API] Page ${page}: ${items.length} items (total ${all.length})`);
      if (items.length < 50 || page >= 30) hasMore = false;
      else { page++; await new Promise(res => setTimeout(res, 300)); }
    } catch (e) {
      console.error(`[API] Erreur page ${page}:`, e.response?.status, e.message);
      hasMore = false;
    }
  }
  return all;
}

// ─── Embed debug : montre la structure brute à Discord ───
async function sendDebugInfo(channel) {
  try {
    const r = await truckyApi.get("/companies", { params: { page: 1, limit: 3 } });
    const items = extractItems(r.data);
    const first = items[0];
    
    if (!first) {
      return channel.send({ embeds: [new EmbedBuilder().setDescription("❌ Aucun item retourné par l'API").setColor(0xff0000)] });
    }

    const keys = Object.keys(first);
    // On cherche les champs qui pourraient indiquer le pays
    const countryFields = keys.filter(k => 
      k.toLowerCase().includes("country") || 
      k.toLowerCase().includes("nation") || 
      k.toLowerCase().includes("lang") ||
      k.toLowerCase().includes("location")
    );
    
    // Champs KM
    const kmFields = keys.filter(k => 
      k.toLowerCase().includes("km") || 
      k.toLowerCase().includes("distance") || 
      k.toLowerCase().includes("miles")
    );

    let desc = `**Toutes les clés du 1er item :**\n\`${keys.join(", ")}\`\n\n`;
    
    desc += `**Champs pays potentiels :**\n`;
    if (countryFields.length) {
      countryFields.forEach(f => desc += `\`${f}\` = \`${JSON.stringify(first[f])}\`\n`);
    } else {
      desc += "_(aucun champ avec 'country' dans le nom)_\n";
    }

    desc += `\n**Champs KM potentiels :**\n`;
    if (kmFields.length) {
      kmFields.forEach(f => desc += `\`${f}\` = \`${JSON.stringify(first[f])}\`\n`);
    } else {
      desc += "_(aucun champ avec 'km' dans le nom)_\n";
    }

    desc += `\n**Exemple d'item complet :**\n\`\`\`json\n${JSON.stringify(first, null, 2).slice(0, 900)}\`\`\``;

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("🔍 Structure brute API Trucky")
        .setDescription(desc.slice(0, 4096))
        .setColor(0x5865f2)
        .setFooter({ text: "DEBUG_MODE=true — désactive avec DEBUG_MODE=false" })]
    });

    // Si des sous-objets existent, les afficher aussi
    const subObjects = keys.filter(k => first[k] && typeof first[k] === "object" && !Array.isArray(first[k]));
    if (subObjects.length) {
      let subDesc = "**Contenu des sous-objets :**\n";
      subObjects.forEach(k => {
        subDesc += `\n**${k}:**\n\`\`\`json\n${JSON.stringify(first[k], null, 2).slice(0, 300)}\`\`\``;
      });
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle("🔍 Sous-objets API Trucky")
          .setDescription(subDesc.slice(0, 4096))
          .setColor(0x5865f2)]
      });
    }
  } catch (e) {
    channel.send({ embeds: [new EmbedBuilder().setDescription(`❌ Erreur debug: ${e.message}`).setColor(0xff0000)] });
  }
}

// ─── Embed stats ───
function buildEmbed(companies) {
  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const hasKm = companies.some(c => getKm(c) !== null);
  const sorted = [...companies]
    .sort((a, b) => hasKm ? (getKm(b) ?? 0) - (getKm(a) ?? 0) : (getMembers(b) ?? 0) - (getMembers(a) ?? 0))
    .slice(0, MAX_COMPANIES);

  const totalKm      = companies.reduce((s, c) => s + (getKm(c) ?? 0), 0);
  const totalMembers = companies.reduce((s, c) => s + (getMembers(c) ?? 0), 0);
  const totalJobs    = companies.reduce((s, c) => s + (getJobs(c) ?? 0), 0);

  const embed = new EmbedBuilder()
    .setTitle("🇫🇷  Statistiques des VTCs Françaises — Trucky Hub")
    .setColor(0x0055a4)
    .setDescription(
      `**${fmt(companies.length)}** entreprises françaises sur Trucky\n\n` +
      `> 🛣️  **KM réels cumulés** : **${totalKm > 0 ? fmtKm(totalKm) : "Non disponible"}**\n` +
      `> 👥  **Membres totaux** : **${fmt(totalMembers)}**\n` +
      `> 📦  **Livraisons** : **${totalJobs > 0 ? fmt(totalJobs) : "Non disponible"}**`
    )
    .setFooter({ text: `Mise à jour : ${now}  •  hub.truckyapp.com` })
    .setTimestamp();

  const medals = ["🥇", "🥈", "🥉"];
  let board = "";
  sorted.forEach((c, i) => {
    const name    = c.name ?? c.company_name ?? "Inconnu";
    const km      = getKm(c);
    const members = getMembers(c);
    const jobs    = getJobs(c);
    const recruit = recruitLabel(c);
    board += `${medals[i] ?? `**${i+1}.**`} **${name}**\n`;
    board += `　🛣️ ${km !== null ? fmtKm(km) : "—"}  👥 ${members !== null ? fmt(members) + " mbr" : "—"}`;
    if (jobs)    board += `  📦 ${fmt(jobs)}`;
    if (recruit) board += `  ${recruit}`;
    board += "\n\n";
  });

  if (board) embed.addFields({ name: `🏆  Top ${sorted.length} VTCs par ${hasKm ? "KM réels" : "membres"}`, value: board });
  embed.addFields({ name: "🔗  Directory", value: "[hub.truckyapp.com/directory](https://hub.truckyapp.com/directory)", inline: true });
  return embed;
}

// ─── Bot Discord ───
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`[Discord] ✅ ${client.user.tag}`);
  client.user.setActivity("les VTCs 🇫🇷", { type: ActivityType.Watching });

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) { console.error("❌ Salon introuvable"); return; }

  if (DEBUG_MODE) {
    console.log("[DEBUG] Mode debug activé — affichage structure API");
    await sendDebugInfo(channel);
    return; // En mode debug on n'envoie pas les stats
  }

  sendStats();
  cron.schedule(STATS_INTERVAL, () => sendStats());
});

async function sendStats() {
  console.log("[Bot] ─── sendStats ───");
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) return;

  let msg;
  try {
    msg = await channel.send({ embeds: [new EmbedBuilder().setDescription("⏳ Récupération en cours…").setColor(0xffa500)] });
    const all = await getAllCompanies();
    console.log(`[Bot] ${all.length} entreprises au total`);

    // Log un exemple pour voir les champs pays
    if (all[0]) {
      const keys = Object.keys(all[0]);
      console.log("[Bot] Clés item:", keys.join(", "));
      const countryFields = keys.filter(k => k.toLowerCase().includes("country") || k.toLowerCase().includes("nation"));
      countryFields.forEach(f => console.log(`[Bot] ${f} =`, all[0][f]));
    }

    const french = all.filter(isFrench);
    console.log(`[Bot] Entreprises françaises : ${french.length} / ${all.length}`);

    if (!french.length) {
      // Fallback : si 0 résultat, afficher un message d'aide avec les champs trouvés
      const sample = all[0] ? Object.keys(all[0]).join(", ") : "API inaccessible";
      return msg.edit({ embeds: [new EmbedBuilder()
        .setTitle("⚠️ Aucune entreprise française trouvée")
        .setDescription(
          `Aucune entrée ne correspond à "France" dans les données.\n\n` +
          `**Champs disponibles dans l'API :**\n\`${sample}\`\n\n` +
          `👉 Active \`DEBUG_MODE=true\` dans les variables Railway pour voir la structure complète.`
        )
        .setColor(0xff8800)] });
    }

    await msg.edit({ embeds: [buildEmbed(french)] });
    console.log(`[Bot] ✅ Stats envoyées (${french.length} VTCs FR)`);
  } catch (e) {
    console.error("[Bot] ❌", e.message);
    msg?.edit({ embeds: [new EmbedBuilder().setDescription(`❌ ${e.message}`).setColor(0xff0000)] }).catch(() => {});
  }
}

if (!DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN manquant"); process.exit(1); }
if (!CHANNEL_ID)    { console.error("❌ CHANNEL_ID manquant");    process.exit(1); }

client.login(DISCORD_TOKEN);

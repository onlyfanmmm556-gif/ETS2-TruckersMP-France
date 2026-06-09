const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const { chromium } = require("playwright");
const cron = require("node-cron");

// ─────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const STATS_INTERVAL = process.env.STATS_INTERVAL || "0 * * * *";
const MAX_COMPANIES  = parseInt(process.env.MAX_COMPANIES || "30");

// ─────────────────────────────────────────────
//  Scraping Playwright — Leaderboard France
// ─────────────────────────────────────────────
async function scrapeFrenchLeaderboard() {
  console.log("[Scraper] Lancement de Playwright...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // ── Intercepte les appels API XHR faits par la page ──
    const intercepted = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (
        (url.includes("e.truckyapp.com") || url.includes("api.truckyapp")) &&
        (url.includes("leaderboard") || url.includes("companies"))
      ) {
        try {
          const json = await response.json();
          console.log("[Intercept] →", url);
          intercepted.push({ url, json });
        } catch (_) {}
      }
    });

    // Navigation
    console.log("[Scraper] Chargement de la page leaderboard...");
    await page.goto("https://hub.truckyapp.com/leaderboards", {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    await page.waitForTimeout(4000);

    // Cliquer sur "Distance Leaderboards" si présent
    try {
      await page.click("text=Distance", { timeout: 3000 });
      await page.waitForTimeout(2000);
    } catch (_) {}

    // Chercher et appliquer le filtre France
    try {
      // Attendre qu'un sélecteur de pays apparaisse
      await page.waitForSelector(
        "select, [class*='country'], [placeholder*='ountry'], [placeholder*='ays']",
        { timeout: 5000 }
      );

      // Essai select natif
      const selects = await page.$$("select");
      for (const sel of selects) {
        const options = await sel.$$("option");
        for (const opt of options) {
          const text = await opt.innerText();
          if (text.trim() === "France") {
            await sel.selectOption({ label: "France" });
            console.log("[Scraper] ✅ Filtre France sélectionné (select)");
            await page.waitForTimeout(3000);
            break;
          }
        }
      }
    } catch (e) {
      console.warn("[Scraper] Filtre pays non trouvé :", e.message);
    }

    // ── Priorité : données interceptées depuis XHR ──
    if (intercepted.length > 0) {
      for (const { url, json } of intercepted) {
        const items = extractItems(json);
        // Filtre si les données contiennent un champ pays
        const frItems = items.filter(c =>
          !c.country_code || c.country_code === "FR" ||
          !c.country || c.country === "FR" || c.country === "France"
        );
        const toUse = frItems.length > 0 ? frItems : items;
        if (toUse.length > 0) {
          console.log(`[Scraper] ✅ ${toUse.length} VTCs via XHR (${url})`);
          return toUse.slice(0, MAX_COMPANIES);
        }
      }
    }

    // ── Fallback : scraping DOM ──
    console.log("[Scraper] Scraping DOM...");
    const companies = await page.evaluate((max) => {
      const results = [];

      // Lignes de tableau
      const rows = document.querySelectorAll(
        "table tbody tr, [class*='leaderboard-row'], [class*='company-row'], [class*='vtc-row']"
      );
      if (rows.length > 0) {
        rows.forEach((row, i) => {
          if (i >= max) return;
          const nameEl = row.querySelector("[class*='name'], td:nth-child(2), strong");
          const kmEl   = row.querySelector("[class*='km'], [class*='distance'], [class*='mile'], td:nth-child(3)");
          const membEl = row.querySelector("[class*='member'], td:nth-child(4)");
          if (nameEl?.innerText) {
            results.push({
              rank: i + 1,
              name: nameEl.innerText.trim(),
              km: kmEl?.innerText?.trim() || null,
              members: membEl?.innerText?.trim() || null,
            });
          }
        });
      }

      return results;
    }, MAX_COMPANIES);

    console.log(`[Scraper] ${companies.length} VTCs scrapées DOM`);
    return companies;

  } finally {
    await browser.close();
  }
}

function extractItems(raw) {
  if (Array.isArray(raw))                                      return raw;
  if (Array.isArray(raw.response))                             return raw.response;
  if (Array.isArray(raw.data))                                 return raw.data;
  if (Array.isArray(raw.companies))                            return raw.companies;
  if (raw.response?.data && Array.isArray(raw.response.data)) return raw.response.data;
  return [];
}

// ─────────────────────────────────────────────
//  Formatage
// ─────────────────────────────────────────────
function fmtKm(val) {
  if (!val && val !== 0) return null;
  if (typeof val === "string" && /[a-z]/i.test(val)) return val;
  const v = Number(String(val).replace(/[^\d.]/g, ""));
  if (isNaN(v) || v === 0) return null;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M km`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)} k km`;
  return `${v.toLocaleString("fr-FR")} km`;
}

function fmtNum(val) {
  if (!val) return null;
  const n = Number(String(val).replace(/[^\d]/g, ""));
  return isNaN(n) || n === 0 ? null : n.toLocaleString("fr-FR");
}

// ─────────────────────────────────────────────
//  Embed Discord
// ─────────────────────────────────────────────
function buildEmbed(companies) {
  const now = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const medals = ["🥇", "🥈", "🥉"];
  let board = "";

  companies.forEach((c, i) => {
    const medal   = medals[i] ?? `\`${String(i + 1).padStart(2)}\``;
    const name    = c.name ?? c.company_name ?? "Nom inconnu";
    const km      = fmtKm(c.km ?? c.real_km ?? c.distance ?? c.total_real_km ?? null);
    const members = fmtNum(c.members ?? c.members_count ?? null);

    board += `${medal} **${name}**\n`;
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
    .setFooter({ text: `Mise à jour : ${now}  •  hub.truckyapp.com` });

  const CHUNK = 1000;
  if (board.length <= CHUNK) {
    embed.addFields({ name: "🏆  Classement", value: board });
  } else {
    const lines = board.split("\n\n").filter(Boolean);
    const mid = Math.ceil(lines.length / 2);
    embed.addFields(
      { name: `🏆  #1 – ${mid}`,            value: lines.slice(0, mid).join("\n\n") + "\n", inline: true },
      { name: `🏆  #${mid + 1} – ${lines.length}`, value: lines.slice(mid).join("\n\n")  + "\n", inline: true }
    );
  }

  embed.addFields({
    name: "🔗  Leaderboard complet",
    value: "[hub.truckyapp.com/leaderboards](https://hub.truckyapp.com/leaderboards)",
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
          .setDescription("⏳ Scraping du classement France en cours… (30–60 sec)")
          .setColor(0xffa500),
      ],
    });

    const companies = await scrapeFrenchLeaderboard();

    if (!companies?.length) {
      return loadingMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setDescription("❌ Aucune donnée. Consultez les logs Railway pour le détail.")
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

// ─────────────────────────────────────────────
//  Démarrage
// ─────────────────────────────────────────────
if (!DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN manquant !"); process.exit(1); }
if (!CHANNEL_ID)    { console.error("❌ CHANNEL_ID manquant !");    process.exit(1); }
client.login(DISCORD_TOKEN);

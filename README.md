# 🚛 Trucky Discord Bot — VTCs Françaises

Bot Discord qui affiche automatiquement les statistiques des entreprises françaises depuis [Trucky Hub](https://hub.truckyapp.com/directory).

## 📊 Ce que le bot affiche

- Nombre total de VTCs françaises sur Trucky
- Kilomètres réels cumulés de toutes les VTCs
- Nombre total de membres et livraisons
- Classement Top 10 des VTCs par KM réels
- Statut de recrutement de chaque VTC

---

## 🚀 Déploiement sur Railway

### 1. Préparer le bot Discord

1. Aller sur [discord.com/developers/applications](https://discord.com/developers/applications)
2. Créer une nouvelle application → **New Application**
3. Onglet **Bot** → cliquer **Add Bot**
4. Copier le **Token** (vous en aurez besoin plus tard)
5. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot`
   - Bot Permissions : `Send Messages`, `Embed Links`, `Read Message History`
6. Copier l'URL générée et l'ouvrir pour inviter le bot sur votre serveur

### 2. Obtenir l'ID du salon Discord

1. Dans Discord : Paramètres utilisateur → Avancé → **Mode développeur** ✅
2. Clic droit sur le salon où poster les stats → **Copier l'identifiant**

### 3. Déployer sur Railway

1. Pusher ce dépôt sur GitHub
2. Aller sur [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Sélectionner votre dépôt
4. Aller dans **Variables** et ajouter :

| Variable | Valeur |
|---|---|
| `DISCORD_TOKEN` | Token de votre bot Discord |
| `CHANNEL_ID` | ID du salon Discord |
| `STATS_INTERVAL` | `0 * * * *` (toutes les heures) |
| `MAX_COMPANIES` | `10` |
| `BOT_NAME` | `TruckyStatsBotFR` |

5. Railway déploiera automatiquement le bot !

---

## ⚙️ Configuration de l'intervalle (STATS_INTERVAL)

| Valeur | Fréquence |
|---|---|
| `0 * * * *` | Toutes les heures |
| `0 */2 * * *` | Toutes les 2 heures |
| `0 */6 * * *` | Toutes les 6 heures |
| `0 8 * * *` | Tous les jours à 8h |
| `0 8,20 * * *` | 2x par jour (8h et 20h) |

---

## 🔧 Test en local

```bash
npm install
cp .env.example .env
# Remplir .env avec vos vraies valeurs
node index.js
```

---

## 📡 API utilisée

- **Trucky Hub API** : `https://e.truckyapp.com/api/v1`
- Endpoint : `/companies?country=FR`
- API publique, pas de token requis
- Documentaton : [e.truckyapp.com/api/docs](https://e.truckyapp.com/api/docs)

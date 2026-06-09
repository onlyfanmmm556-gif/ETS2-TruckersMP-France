# 🚛 Trucky Discord Bot — Top 30 VTCs Françaises

Bot Discord qui affiche automatiquement le classement mensuel des VTCs françaises depuis [Trucky Hub](https://hub.truckyapp.com/leaderboards).

## 📊 Ce que le bot affiche

- Top 30 VTCs françaises classées par KM du mois
- KM parcourus et nombre de membres par VTC
- Mise à jour automatique selon l'intervalle configuré

---

## 🚀 Déploiement sur Railway

### 1. Préparer le bot Discord

1. Aller sur [discord.com/developers/applications](https://discord.com/developers/applications)
2. Créer une nouvelle application → **New Application**
3. Onglet **Bot** → cliquer **Add Bot**
4. Copier le **Token**
5. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot`
   - Bot Permissions : `Send Messages`, `Embed Links`, `Read Message History`
6. Copier l'URL générée et l'ouvrir pour inviter le bot sur votre serveur

### 2. Obtenir l'ID du salon Discord

1. Discord : Paramètres → Avancé → **Mode développeur** ✅
2. Clic droit sur le salon → **Copier l'identifiant**

### 3. Déployer sur Railway

1. Pusher ce dépôt sur GitHub
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Aller dans **Variables** et ajouter :

| Variable | Valeur |
|---|---|
| `DISCORD_TOKEN` | Token de votre bot Discord |
| `CHANNEL_ID` | ID du salon Discord |
| `STATS_INTERVAL` | `0 * * * *` (toutes les heures) |
| `MAX_COMPANIES` | `30` |
| `BOT_NAME` | `TruckyStatsBotFR` |

---

## ⚙️ Intervalles disponibles

| Valeur | Fréquence |
|---|---|
| `0 * * * *` | Toutes les heures |
| `0 */2 * * *` | Toutes les 2 heures |
| `0 */6 * * *` | Toutes les 6 heures |
| `0 8 * * *` | Tous les jours à 8h |
| `0 8,20 * * *` | 2x par jour (8h et 20h) |

---

## 📡 API utilisée

- **Endpoint** : `https://e.truckyapp.com/api/v1/users/leaderboards`
- **Paramètres** : `period=monthly&country=france&perPage=50`
- API publique, pas de token requis
- Les users français sont regroupés par VTC et triés par KM total

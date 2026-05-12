const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../config.json');

const DEFAULT_BOT = {
    botId: null,
    alertChannelId: null,
    statusPostChannelId: null,
    statusPostMessageId: null,
    pingRoleId: null,
    customImageFilename: null,
    history: [],
};

const DEFAULT_CONFIG = {
    bots: {},
    updateIntervalMinutes: 5,
};

function readRaw() {
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return null;
    }
}

function writeRaw(cfg) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    } catch {}
}

function migrate(raw) {
    if (!raw) return { ...DEFAULT_CONFIG };
    if (raw.bots && typeof raw.bots === 'object') {
        return {
            ...DEFAULT_CONFIG,
            ...raw,
            bots: raw.bots,
        };
    }
    // Legacy single-bot config -> migrate
    const migrated = { ...DEFAULT_CONFIG };
    if (raw.updateIntervalMinutes) migrated.updateIntervalMinutes = raw.updateIntervalMinutes;
    if (raw.targetBotId) {
        migrated.bots[raw.targetBotId] = {
            ...DEFAULT_BOT,
            botId: raw.targetBotId,
            alertChannelId: raw.alertChannelId ?? null,
            statusPostChannelId: raw.statusPostChannelId ?? null,
            statusPostMessageId: raw.statusPostMessageId ?? null,
            pingRoleId: raw.pingRoleId ?? null,
            customImageFilename: raw.customImageFilename ?? null,
            history: raw.history ?? [],
        };
    }
    writeRaw(migrated);
    return migrated;
}

function getConfig() {
    return migrate(readRaw());
}

function setConfig(cfg) {
    writeRaw(cfg);
}

function setGlobal(updates) {
    const cfg = getConfig();
    const next = { ...cfg, ...updates };
    setConfig(next);
    return next;
}

function getBot(botId) {
    return getConfig().bots[botId] || null;
}

function getAllBots() {
    return getConfig().bots;
}

function upsertBot(botId, updates) {
    const cfg = getConfig();
    const existing = cfg.bots[botId] || { ...DEFAULT_BOT, botId };
    cfg.bots[botId] = { ...existing, ...updates, botId };
    setConfig(cfg);
    return cfg.bots[botId];
}

function removeBot(botId) {
    const cfg = getConfig();
    delete cfg.bots[botId];
    setConfig(cfg);
}

function pushHistory(botId, event) {
    const cfg = getConfig();
    if (!cfg.bots[botId]) return;
    cfg.bots[botId].history = cfg.bots[botId].history || [];
    cfg.bots[botId].history.push(event);
    setConfig(cfg);
}

function updateLastOfflineDuration(botId, duration) {
    const cfg = getConfig();
    const bot = cfg.bots[botId];
    if (!bot) return;
    const history = bot.history || [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].event === 'offline' && !history[i].duration) {
            history[i].duration = duration;
            break;
        }
    }
    cfg.bots[botId].history = history;
    setConfig(cfg);
}

module.exports = {
    getConfig,
    setConfig,
    setGlobal,
    getBot,
    getAllBots,
    upsertBot,
    removeBot,
    pushHistory,
    updateLastOfflineDuration,
    DEFAULT_BOT,
};

// Built by Haymooed

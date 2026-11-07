import { world, system, ItemStack } from '@minecraft/server';

const settings = new Map();
const UNIVERSAL_MODE_KEY = "parkour:universal_settings_enabled";
const UNIVERSAL_SETTINGS_KEY = "parkour:universal_settings";
const DEFAULT_SETTINGS = {
    land_dash: {
        enabled: true,
        name: "parkour.setting.land_dash",
        upDownForce: 2.7,
        sideForce: 2.1,
        verticalForce: 0.1,
        cooldownSeconds: 1.5,
        immunitySeconds: 0.8
    },
    aqua_dash: { enabled: true, name: "parkour.setting.aqua_dash" },
    slide: {
        enabled: true,
        canStunPlayers: true,
        canReceiveStun: true,
        canPushPlayers: true,
        canReceivePush: true,
        canStunEntities: true,
        canPushEntities: true,
        stunPlayersSeconds: 2,
        receiveStunSeconds: 2,
        pushPlayersIntensity: 1.8,
        receivePushIntensity: 1.8,
        stunEntitiesSeconds: 2,
        pushEntitiesIntensity: 1.8,
        invulnerabilitySeconds: 0.9,
        name: "parkour.setting.slide"
    },
    crawl: { enabled: true, name: "parkour.setting.crawl" },
    air_jump: { enabled: true, name: "parkour.setting.air_jump" }, 
    air_jump_old: { enabled: true, name: "parkour.setting.air_jump_old" }, 
    jump_fence: { enabled: true, name: "parkour.setting.jump_fence" },
    grab: { enabled: true, name: "parkour.setting.grab" },
    wall_slide: { enabled: true, name: "parkour.setting.wall_slide" },
    footstep: { enabled: true, name: "parkour.setting.footstep" },
    debuff: { enabled: true, level: 50, name: "parkour.setting.debuff" }
};

const LAND_DASH_OPTION_RANGES = {
    upDownForce: { min: 1, max: 10 },
    sideForce: { min: 1, max: 10 },
    verticalForce: { min: 0.1, max: 2 },
    cooldownSeconds: { min: 1, max: 10 },
    immunitySeconds: { min: 0, max: 5 }
};

const SLIDE_OPTION_RANGES = {
    stunPlayersSeconds: { min: 1, max: 10 },
    receiveStunSeconds: { min: 1, max: 10 },
    pushPlayersIntensity: { min: 0.1, max: 10 },
    receivePushIntensity: { min: 0.1, max: 10 },
    stunEntitiesSeconds: { min: 1, max: 10 },
    pushEntitiesIntensity: { min: 0.1, max: 10 },
    invulnerabilitySeconds: { min: 0.1, max: 5 }
};

const UNIVERSAL_SETTINGS_DEFAULTS = {
    land_dash: {
        upDownForce: DEFAULT_SETTINGS.land_dash.upDownForce,
        sideForce: DEFAULT_SETTINGS.land_dash.sideForce,
        verticalForce: DEFAULT_SETTINGS.land_dash.verticalForce,
        cooldownSeconds: DEFAULT_SETTINGS.land_dash.cooldownSeconds,
        immunitySeconds: DEFAULT_SETTINGS.land_dash.immunitySeconds
    },
    slide: Object.fromEntries([
        "canStunPlayers",
        "canReceiveStun",
        "canPushPlayers",
        "canReceivePush",
        "canStunEntities",
        "canPushEntities",
        ...Object.keys(SLIDE_OPTION_RANGES)
    ].map(option => [option, DEFAULT_SETTINGS.slide[option]])),
    debuff: {
        enabled: DEFAULT_SETTINGS.debuff.enabled,
        level: DEFAULT_SETTINGS.debuff.level
    }
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getUniversalSettings() {
    const defaults = clone(UNIVERSAL_SETTINGS_DEFAULTS);
    const saved = world.getDynamicProperty(UNIVERSAL_SETTINGS_KEY);
    if (typeof saved !== "string" || !saved) return defaults;

    try {
        const parsed = JSON.parse(saved);
        for (const [section, options] of Object.entries(defaults)) {
            if (!parsed[section] || typeof parsed[section] !== "object") continue;
            for (const option of Object.keys(options)) {
                if (typeof options[option] === "boolean") {
                    if (typeof parsed[section][option] === "boolean") {
                        defaults[section][option] = parsed[section][option];
                    }
                } else if (Number.isFinite(parsed[section][option])) {
                    defaults[section][option] = parsed[section][option];
                }
            }
        }
    } catch (error) {
        console.warn(`[Parkour] Falha ao carregar configurações universais: ${error}`);
    }
    return defaults;
}

function saveUniversalSettings(value) {
    world.setDynamicProperty(UNIVERSAL_SETTINGS_KEY, JSON.stringify(value));
}

function useUniversalSettings() {
    return world.getDynamicProperty(UNIVERSAL_MODE_KEY) === true;
}

export const SettingsManager = {
    load: name => {
        try {
            const saved = world.getDynamicProperty(`parkour:settings_${name}`);
            if (typeof saved === "string" && saved) {
                const parsed = JSON.parse(saved);
                let updated = false;
                // Preenche automaticamente chaves novas (como 'footstep') em saves antigos
                for (const key in DEFAULT_SETTINGS) {
                    if (!parsed[key]) {
                        parsed[key] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key]));
                        updated = true;
                        continue;
                    }

                    for (const [option, defaultValue] of Object.entries(DEFAULT_SETTINGS[key])) {
                        if (parsed[key][option] === undefined) {
                            parsed[key][option] = defaultValue;
                            updated = true;
                        }
                    }
                }
                settings.set(name, parsed);
                if (updated) SettingsManager.save(name);
            } else {
                settings.set(name, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
            }
        } catch (error) {
            console.warn(`[Parkour] Falha ao carregar configurações de ${name}: ${error}`);
            settings.set(name, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
        }
    },
    save: name => {
        const s = settings.get(name);
        if (s) world.setDynamicProperty(`parkour:settings_${name}`, JSON.stringify(s));
    },
    get: name => {
        if (!settings.has(name)) SettingsManager.load(name);
        return settings.get(name);
    },
    enabled: (name, move) => {
        const s = SettingsManager.get(name);
        return s[move]?.enabled ?? true;
    },
    
    toggle: (name, move) => {
        const s = SettingsManager.get(name);
        if (!s[move]) {
            s[move] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[move] || { enabled: true }));
        }
        s[move].enabled = !s[move].enabled;
        SettingsManager.save(name);
        return s[move].enabled;
    },

    set: (name, move, value) => {
        if (move === "debuff" && useUniversalSettings()) {
            const universal = getUniversalSettings();
            universal.debuff.enabled = value;
            saveUniversalSettings(universal);
            return;
        }

        const s = SettingsManager.get(name);
        if (!s[move]) {
            s[move] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[move] || { enabled: value }));
        }
        s[move].enabled = value;
        SettingsManager.save(name);
    },

    setLevel: (name, move, value) => {
        if (move === "debuff" && useUniversalSettings()) {
            const universal = getUniversalSettings();
            universal.debuff.level = value;
            saveUniversalSettings(universal);
            return;
        }

        const s = SettingsManager.get(name);
        if (!s[move]) {
            s[move] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[move] || { level: value }));
        }
        s[move].level = value;
        SettingsManager.save(name);
    },

    setSlideOptions: (name, values) => {
        const booleanOptions = [
            "canStunPlayers",
            "canReceiveStun",
            "canPushPlayers",
            "canReceivePush",
            "canStunEntities",
            "canPushEntities"
        ];
        if (booleanOptions.some(option => typeof values[option] !== "boolean")) {
            throw new TypeError("Slide interaction settings must be booleans.");
        }

        const normalized = {};
        for (const option of booleanOptions) {
            normalized[option] = values[option];
        }
        for (const [option, range] of Object.entries(SLIDE_OPTION_RANGES)) {
            const value = values[option];
            if (!Number.isFinite(value) || value < range.min || value > range.max) {
                throw new RangeError(`Invalid slide setting: ${option}.`);
            }
            normalized[option] = Math.round(value * 10) / 10;
        }

        if (useUniversalSettings()) {
            const universal = getUniversalSettings();
            universal.slide = normalized;
            saveUniversalSettings(universal);
            return;
        }

        const slideSettings = SettingsManager.get(name).slide;
        Object.assign(slideSettings, normalized);
        SettingsManager.save(name);
    },

    setLandDashOptions: (name, values) => {
        const normalized = {};

        if (values.enabled !== undefined && typeof values.enabled !== "boolean") {
            throw new TypeError("Dash enabled setting must be a boolean.");
        }

        for (const [option, range] of Object.entries(LAND_DASH_OPTION_RANGES)) {
            const value = values[option];
            if (!Number.isFinite(value) || value < range.min || value > range.max) {
                throw new RangeError(`Invalid land dash setting: ${option}.`);
            }
            normalized[option] = Math.round(value * 10) / 10;
        }

        if (useUniversalSettings()) {
            const universal = getUniversalSettings();
            universal.land_dash = normalized;
            saveUniversalSettings(universal);
            return;
        }

        const s = SettingsManager.get(name);
        const landDash = s.land_dash;
        if (values.enabled !== undefined) normalized.enabled = values.enabled;
        Object.assign(landDash, normalized);
        SettingsManager.save(name);
    },

    resetAll: name => {
        settings.set(name, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
        SettingsManager.save(name);
        if (useUniversalSettings()) {
            saveUniversalSettings(clone(UNIVERSAL_SETTINGS_DEFAULTS));
        }
    },

    getAll: () => Object.keys(DEFAULT_SETTINGS),
    isUniversalModeEnabled: useUniversalSettings,
    enableUniversalMode: name => {
        const personal = SettingsManager.get(name);
        const universal = clone(UNIVERSAL_SETTINGS_DEFAULTS);
        for (const section of Object.keys(universal)) {
            for (const option of Object.keys(universal[section])) {
                universal[section][option] = personal[section][option];
            }
        }
        saveUniversalSettings(universal);
        world.setDynamicProperty(UNIVERSAL_MODE_KEY, true);
    },
    disableUniversalMode: () => {
        world.setDynamicProperty(UNIVERSAL_MODE_KEY, false);
    },
    getStatus: name => {
        const s = SettingsManager.get(name);
        const status = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(m => [m, {
            enabled: s[m]?.enabled ?? DEFAULT_SETTINGS[m].enabled,
            canStunPlayers: s[m]?.canStunPlayers ?? DEFAULT_SETTINGS[m].canStunPlayers,
            canReceiveStun: s[m]?.canReceiveStun ?? DEFAULT_SETTINGS[m].canReceiveStun,
            canPushPlayers: s[m]?.canPushPlayers ?? DEFAULT_SETTINGS[m].canPushPlayers,
            canReceivePush: s[m]?.canReceivePush ?? DEFAULT_SETTINGS[m].canReceivePush,
            canStunEntities: s[m]?.canStunEntities ?? DEFAULT_SETTINGS[m].canStunEntities,
            canPushEntities: s[m]?.canPushEntities ?? DEFAULT_SETTINGS[m].canPushEntities,
            stunPlayersSeconds: s[m]?.stunPlayersSeconds ?? DEFAULT_SETTINGS[m].stunPlayersSeconds,
            receiveStunSeconds: s[m]?.receiveStunSeconds ?? DEFAULT_SETTINGS[m].receiveStunSeconds,
            pushPlayersIntensity: s[m]?.pushPlayersIntensity ?? DEFAULT_SETTINGS[m].pushPlayersIntensity,
            receivePushIntensity: s[m]?.receivePushIntensity ?? DEFAULT_SETTINGS[m].receivePushIntensity,
            stunEntitiesSeconds: s[m]?.stunEntitiesSeconds ?? DEFAULT_SETTINGS[m].stunEntitiesSeconds,
            pushEntitiesIntensity: s[m]?.pushEntitiesIntensity ?? DEFAULT_SETTINGS[m].pushEntitiesIntensity,
            invulnerabilitySeconds: s[m]?.invulnerabilitySeconds ?? DEFAULT_SETTINGS[m].invulnerabilitySeconds,
            level: s[m]?.level ?? DEFAULT_SETTINGS[m].level,
            upDownForce: s[m]?.upDownForce ?? DEFAULT_SETTINGS[m].upDownForce,
            sideForce: s[m]?.sideForce ?? DEFAULT_SETTINGS[m].sideForce,
            verticalForce: s[m]?.verticalForce ?? DEFAULT_SETTINGS[m].verticalForce,
            cooldownSeconds: s[m]?.cooldownSeconds ?? DEFAULT_SETTINGS[m].cooldownSeconds,
            immunitySeconds: s[m]?.immunitySeconds ?? DEFAULT_SETTINGS[m].immunitySeconds,
            name: DEFAULT_SETTINGS[m].name
        }]));

        if (useUniversalSettings()) {
            const universal = getUniversalSettings();
            Object.assign(status.land_dash, universal.land_dash);
            Object.assign(status.slide, universal.slide);
            Object.assign(status.debuff, universal.debuff);
        }
        return status;
    }
};

world.afterEvents.playerSpawn.subscribe(e => {
    const player = e.player;

    if (!settings.has(player.name)) SettingsManager.load(player.name);

    if (e.initialSpawn && !player.hasTag("parkour_config_received")) {
        system.run(() => {
            try {
                const inv = player.getComponent("minecraft:inventory")?.container;
                if (inv) {
                    const item = new ItemStack("parkour:settings", 1);
                    item.keepOnDeath = true;
                    inv.addItem(item);
                    
                    player.addTag("parkour_config_received");
                }
            } catch (error) {
                console.warn(`[Parkour] Falha ao entregar o item de configurações para ${player.name}: ${error}`);
            }
        });
    }
});

world.afterEvents.playerLeave.subscribe(event => {
    settings.delete(event.playerName);
});

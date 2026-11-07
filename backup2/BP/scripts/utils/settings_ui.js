import { world, system, EquipmentSlot, GameMode } from '@minecraft/server';
import {
    CustomForm,
    ObservableBoolean,
    ObservableNumber
} from '@minecraft/server-ui';
import { SettingsManager } from './settings_manager.js';

const SETTINGS_ITEM_ID = 'parkour:settings';

world.afterEvents.itemUse.subscribe((event) => {
    const item = event.itemStack;
    const player = event.source;

    if (item.typeId !== SETTINGS_ITEM_ID) return;

    if (!item.keepOnDeath) {
        system.run(() => {
            const equip = player.getComponent("minecraft:equippable");
            if (equip) {
                const handItem = equip.getEquipment(EquipmentSlot.Mainhand);
                if (handItem && handItem.typeId === SETTINGS_ITEM_ID) {
                    handItem.keepOnDeath = true;
                    equip.setEquipment(EquipmentSlot.Mainhand, handItem);
                }
            }
        });
    }

    system.run(() => showSettingsMenu(player));
});

function showSettingsMenu(player) {
    try {
        const settings = SettingsManager.getStatus(player.name);
        const moves = SettingsManager.getAll().filter((move) => move !== 'debuff');
        const toggles = Object.fromEntries(moves.map((move) => [
            move,
            new ObservableBoolean(settings[move].enabled, { clientWritable: true })
        ]));
        const form = new CustomForm(player, { translate: "parkour.ui.title" })
            .header({ translate: "parkour.ui.general" })
            .label({ translate: "parkour.ui.choose_setting" });

        for (const move of moves) {
            form.divider().toggle({ translate: settings[move].name }, toggles[move]);
        }

        form.button({ translate: "parkour.ui.save" }, () => {
            system.run(() => {
                saveAbilityToggles(player, moves, toggles);
                form.close();
            });
        });
        form.button({ translate: "parkour.ui.advanced" }, () => {
            system.run(() => {
                saveAbilityToggles(player, moves, toggles, false);
                try {
                    form.close();
                    system.runTimeout(() => showAdvancedSettings(player), 1);
                } catch (error) {
                    console.warn(`[Parkour] Falha ao abrir configurações avançadas: ${error}`);
                    player.sendMessage({ translate: "parkour.ui.settings.error" });
                }
            });
        });
        form.closeButton();

        form.show().catch((error) => {
            console.warn(`[Parkour] Falha ao abrir configurações: ${error}`);
            player.sendMessage({ translate: "parkour.ui.settings.error" });
        });
    } catch (error) {
        console.warn(`[Parkour] Falha ao preparar configurações: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function saveAbilityToggles(player, moves, toggles, notify = true) {
    try {
        let changed = false;
        const current = SettingsManager.getStatus(player.name);
        for (const move of moves) {
            const enabled = toggles[move].getData();
            if (current[move].enabled === enabled) continue;

            SettingsManager.set(player.name, move, enabled);
            changed = true;
        }

        if (notify) {
            player.sendMessage({
                translate: changed ? "parkour.ui.settings.saved" : "parkour.chat.no_change"
            });
        }
    } catch (error) {
        console.warn(`[Parkour] Falha ao salvar ativações de habilidades: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function showAdvancedSettings(player) {
    try {
        const universalMode = SettingsManager.isUniversalModeEnabled();
        if (universalMode && !isCreative(player)) {
            player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
            return;
        }

        const settings = SettingsManager.getStatus(player.name);
        const slideValues = {
            canStunPlayers: new ObservableBoolean(settings.slide.canStunPlayers, { clientWritable: true }),
            canReceiveStun: new ObservableBoolean(settings.slide.canReceiveStun, { clientWritable: true }),
            canPushPlayers: new ObservableBoolean(settings.slide.canPushPlayers, { clientWritable: true }),
            canReceivePush: new ObservableBoolean(settings.slide.canReceivePush, { clientWritable: true }),
            canStunEntities: new ObservableBoolean(settings.slide.canStunEntities, { clientWritable: true }),
            canPushEntities: new ObservableBoolean(settings.slide.canPushEntities, { clientWritable: true }),
            stunPlayersSeconds: new ObservableNumber(settings.slide.stunPlayersSeconds, { clientWritable: true }),
            receiveStunSeconds: new ObservableNumber(settings.slide.receiveStunSeconds, { clientWritable: true }),
            pushPlayersIntensity: new ObservableNumber(settings.slide.pushPlayersIntensity, { clientWritable: true }),
            receivePushIntensity: new ObservableNumber(settings.slide.receivePushIntensity, { clientWritable: true }),
            stunEntitiesSeconds: new ObservableNumber(settings.slide.stunEntitiesSeconds, { clientWritable: true }),
            pushEntitiesIntensity: new ObservableNumber(settings.slide.pushEntitiesIntensity, { clientWritable: true }),
            invulnerabilitySeconds: new ObservableNumber(settings.slide.invulnerabilitySeconds, { clientWritable: true })
        };
        const dashValues = {
            upDownForce: new ObservableNumber(settings.land_dash.upDownForce, { clientWritable: true }),
            sideForce: new ObservableNumber(settings.land_dash.sideForce, { clientWritable: true }),
            verticalForce: new ObservableNumber(settings.land_dash.verticalForce, { clientWritable: true }),
            cooldownSeconds: new ObservableNumber(settings.land_dash.cooldownSeconds, { clientWritable: true }),
            immunitySeconds: new ObservableNumber(settings.land_dash.immunitySeconds, { clientWritable: true })
        };
        const debuffEnabled = new ObservableBoolean(settings.debuff.enabled, { clientWritable: true });
        const debuffLevel = new ObservableNumber(settings.debuff.level, { clientWritable: true });
        const adminModeToggle = new ObservableBoolean(universalMode, { clientWritable: !universalMode });
        const form = new CustomForm(player, { translate: "parkour.ui.advanced" });

        if (universalMode) {
            form.label({ translate: "parkour.ui.admin.universal_active" });
        }

        form.header({ translate: "parkour.ui.debuff.section" })
            .toggle(
                { translate: "parkour.setting.debuff" },
                debuffEnabled,
                { description: { translate: "parkour.ui.debuff.info" } }
            )
            .slider(
                { translate: "parkour.setting.debuff_level" },
                debuffLevel,
                20,
                80,
                { step: 5 }
            )
            .header({ translate: "parkour.ui.dash.section" })
            .dropdown(
                { translate: "parkour.setting.dash.forward_force" },
                dashValues.upDownForce,
                createTenthOptions(10, 100),
                { description: { translate: "parkour.ui.dash.info.force" } }
            )
            .dropdown(
                { translate: "parkour.setting.dash.side_force" },
                dashValues.sideForce,
                createTenthOptions(10, 100),
                { description: { translate: "parkour.ui.dash.info.force" } }
            )
            .dropdown(
                { translate: "parkour.setting.dash.vertical_force" },
                dashValues.verticalForce,
                createTenthOptions(1, 20),
                { description: { translate: "parkour.ui.dash.info.force" } }
            )
            .dropdown(
                { translate: "parkour.setting.dash.cooldown" },
                dashValues.cooldownSeconds,
                createTenthOptions(10, 100),
                { description: { translate: "parkour.ui.dash.info.seconds" } }
            )
            .dropdown(
                { translate: "parkour.setting.dash.immunity" },
                dashValues.immunitySeconds,
                createTenthOptions(0, 50),
                { description: { translate: "parkour.ui.dash.info.seconds" } }
            )
            .header({ translate: "parkour.ui.slide.stun.section" })
            .toggle(
                { translate: "parkour.ui.slide.stun.can_stun_players" },
                slideValues.canStunPlayers
            )
            .toggle(
                { translate: "parkour.ui.slide.stun.can_receive_stun" },
                slideValues.canReceiveStun
            )
            .dropdown(
                { translate: "parkour.ui.slide.stun.cause_duration" },
                slideValues.stunPlayersSeconds,
                createTenthOptions(10, 100),
                { description: { translate: "parkour.ui.dash.info.seconds" } }
            )
            .dropdown(
                { translate: "parkour.ui.slide.stun.receive_duration" },
                slideValues.receiveStunSeconds,
                createTenthOptions(10, 100),
                { description: { translate: "parkour.ui.dash.info.seconds" } }
            )
            .toggle(
                { translate: "parkour.ui.slide.push.can_push_players" },
                slideValues.canPushPlayers
            )
            .toggle(
                { translate: "parkour.ui.slide.push.can_receive_push" },
                slideValues.canReceivePush
            )
            .dropdown(
                { translate: "parkour.ui.slide.push.cause_intensity" },
                slideValues.pushPlayersIntensity,
                createTenthOptions(1, 100)
            )
            .dropdown(
                { translate: "parkour.ui.slide.push.receive_intensity" },
                slideValues.receivePushIntensity,
                createTenthOptions(1, 100)
            )
            .header({ translate: "parkour.ui.slide.entities.section" })
            .toggle(
                { translate: "parkour.ui.slide.entities.can_stun" },
                slideValues.canStunEntities
            )
            .toggle(
                { translate: "parkour.ui.slide.entities.can_push" },
                slideValues.canPushEntities
            )
            .dropdown(
                { translate: "parkour.ui.slide.entities.stun_duration" },
                slideValues.stunEntitiesSeconds,
                createTenthOptions(10, 100),
                { description: { translate: "parkour.ui.dash.info.seconds" } }
            )
            .dropdown(
                { translate: "parkour.ui.slide.entities.push_intensity" },
                slideValues.pushEntitiesIntensity,
                createTenthOptions(1, 100)
            )
            .header({ translate: "parkour.ui.slide.defense.section" })
            .dropdown(
                { translate: "parkour.ui.slide.defense.invulnerability" },
                slideValues.invulnerabilitySeconds,
                createTenthOptions(1, 50),
                { description: { translate: "parkour.ui.dash.info.seconds" } }
            );

        if (!universalMode) {
            form.header({ translate: "parkour.ui.admin.section" })
                .toggle(
                    { translate: "parkour.ui.admin.allow_only_creative" },
                    adminModeToggle,
                    { description: { translate: "parkour.ui.admin.info" } }
                );
        }

        form.button({ translate: "parkour.ui.save" }, () => {
            system.run(() => saveAdvancedSettings(
                player,
                form,
                settings,
                slideValues,
                dashValues,
                debuffEnabled,
                debuffLevel,
                adminModeToggle,
                universalMode
            ));
        });
        form.button({ translate: "parkour.ui.settings.reset" }, () => {
            system.run(() => {
                try {
                    form.close();
                    system.runTimeout(() => showResetConfirmation(player), 1);
                } catch (error) {
                    console.warn(`[Parkour] Falha ao abrir confirmação do reset: ${error}`);
                    player.sendMessage({ translate: "parkour.ui.settings.error" });
                }
            });
        });
        if (universalMode) {
            form.button({ translate: "parkour.ui.admin.return_to_personal" }, () => {
                system.run(() => {
                    try {
                        form.close();
                        system.runTimeout(() => showDisableUniversalConfirmation(player), 1);
                    } catch (error) {
                        console.warn(`[Parkour] Falha ao voltar às configurações pessoais: ${error}`);
                        player.sendMessage({ translate: "parkour.ui.settings.error" });
                    }
                });
            });
        }
        form.closeButton();

        form.show().catch((error) => {
            console.warn(`[Parkour] Falha ao abrir configurações avançadas: ${error}`);
            player.sendMessage({ translate: "parkour.ui.settings.error" });
        });
    } catch (error) {
        console.warn(`[Parkour] Falha ao preparar configurações avançadas: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function saveAdvancedSettings(
    player,
    form,
    settings,
    slideValues,
    dashValues,
    debuffEnabled,
    debuffLevel,
    adminModeToggle,
    universalMode
) {
    try {
        const dashOptions = {
            upDownForce: normalizeTenth(dashValues.upDownForce.getData()),
            sideForce: normalizeTenth(dashValues.sideForce.getData()),
            verticalForce: normalizeTenth(dashValues.verticalForce.getData()),
            cooldownSeconds: normalizeTenth(dashValues.cooldownSeconds.getData()),
            immunitySeconds: normalizeTenth(dashValues.immunitySeconds.getData())
        };
        const slideOptions = Object.fromEntries([
            "canStunPlayers",
            "canReceiveStun",
            "canPushPlayers",
            "canReceivePush",
            "canStunEntities",
            "canPushEntities"
        ].map((option) => [option, slideValues[option].getData()]));
        for (const option of [
            "stunPlayersSeconds",
            "receiveStunSeconds",
            "pushPlayersIntensity",
            "receivePushIntensity",
            "stunEntitiesSeconds",
            "pushEntitiesIntensity",
            "invulnerabilitySeconds"
        ]) {
            slideOptions[option] = normalizeTenth(slideValues[option].getData());
        }

        const nextDebuffEnabled = debuffEnabled.getData();
        const nextDebuffLevel = debuffLevel.getData();
        const changed = Object.entries(dashOptions).some(([option, value]) => (
            settings.land_dash[option] !== value
        )) || Object.entries(slideOptions).some(([option, value]) => (
            settings.slide[option] !== value
        )) || settings.debuff.enabled !== nextDebuffEnabled
            || settings.debuff.level !== nextDebuffLevel;

        SettingsManager.setLandDashOptions(player.name, dashOptions);
        SettingsManager.setSlideOptions(player.name, slideOptions);
        SettingsManager.set(player.name, 'debuff', nextDebuffEnabled);
        SettingsManager.setLevel(player.name, 'debuff', nextDebuffLevel);

        const enablingUniversalMode = !universalMode && adminModeToggle.getData();
        if (enablingUniversalMode && !isCreative(player)) {
            form.close();
            player.sendMessage({
                translate: changed ? "parkour.ui.settings.saved" : "parkour.chat.no_change"
            });
            player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
            return;
        }

        form.close();
        player.sendMessage({
            translate: changed ? "parkour.ui.settings.saved" : "parkour.chat.no_change"
        });
        if (enablingUniversalMode) {
            system.runTimeout(() => showEnableUniversalConfirmation(player), 1);
        }
    } catch (error) {
        console.warn(`[Parkour] Falha ao salvar configurações avançadas: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function showEnableUniversalConfirmation(player) {
    try {
        if (!isCreative(player)) {
            player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
            return;
        }

        const form = new CustomForm(player, { translate: "parkour.ui.admin.enable_title" })
            .label({ translate: "parkour.ui.admin.enable_confirm" });
        form.button({ translate: "parkour.ui.admin.confirm" }, () => {
            system.run(() => {
                try {
                    if (!isCreative(player)) {
                        form.close();
                        player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
                        return;
                    }
                    SettingsManager.enableUniversalMode(player.name);
                    form.close();
                    player.sendMessage({ translate: "parkour.ui.admin.enabled" });
                    system.runTimeout(() => showAdvancedSettings(player), 1);
                } catch (error) {
                    console.warn(`[Parkour] Falha ao ativar configurações universais: ${error}`);
                    player.sendMessage({ translate: "parkour.ui.settings.error" });
                }
            });
        });
        form.button({ translate: "parkour.ui.cancel" }, () => {
            system.run(() => {
                form.close();
                system.runTimeout(() => showAdvancedSettings(player), 1);
            });
        });
        form.closeButton();
        form.show().catch((error) => {
            console.warn(`[Parkour] Falha ao confirmar configurações universais: ${error}`);
            player.sendMessage({ translate: "parkour.ui.settings.error" });
        });
    } catch (error) {
        console.warn(`[Parkour] Falha ao preparar confirmação de modo administrador: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function showDisableUniversalConfirmation(player) {
    try {
        if (!isCreative(player)) {
            player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
            return;
        }

        const form = new CustomForm(player, { translate: "parkour.ui.admin.disable_title" })
            .label({ translate: "parkour.ui.admin.disable_confirm" });
        form.button({ translate: "parkour.ui.admin.confirm" }, () => {
            system.run(() => {
                try {
                    if (!isCreative(player)) {
                        form.close();
                        player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
                        return;
                    }
                    SettingsManager.disableUniversalMode();
                    form.close();
                    player.sendMessage({ translate: "parkour.ui.admin.disabled" });
                    system.runTimeout(() => showAdvancedSettings(player), 1);
                } catch (error) {
                    console.warn(`[Parkour] Falha ao desativar configurações universais: ${error}`);
                    player.sendMessage({ translate: "parkour.ui.settings.error" });
                }
            });
        });
        form.button({ translate: "parkour.ui.cancel" }, () => {
            system.run(() => {
                form.close();
                system.runTimeout(() => showAdvancedSettings(player), 1);
            });
        });
        form.closeButton();
        form.show().catch((error) => {
            console.warn(`[Parkour] Falha ao confirmar retorno às configurações pessoais: ${error}`);
            player.sendMessage({ translate: "parkour.ui.settings.error" });
        });
    } catch (error) {
        console.warn(`[Parkour] Falha ao preparar retorno às configurações pessoais: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function showResetConfirmation(player) {
    try {
        const universalMode = SettingsManager.isUniversalModeEnabled();
        if (universalMode && !isCreative(player)) {
            player.sendMessage({ translate: "parkour.ui.admin.creative_required" });
            return;
        }

        const confirmation = universalMode
            ? "parkour.ui.settings.reset_confirm_universal"
            : "parkour.ui.settings.reset_confirm";
        const form = new CustomForm(player, { translate: "parkour.ui.settings.reset_title" })
            .label({ translate: confirmation });

        form.button({ translate: "parkour.ui.settings.reset_confirm_button" }, () => {
            system.run(() => {
                try {
                    SettingsManager.resetAll(player.name);
                    form.close();
                    player.sendMessage({ translate: "parkour.ui.settings.reset_done" });
                    system.runTimeout(() => showAdvancedSettings(player), 1);
                } catch (error) {
                    console.warn(`[Parkour] Falha ao restaurar todas as configurações: ${error}`);
                    player.sendMessage({ translate: "parkour.ui.settings.error" });
                }
            });
        });
        form.button({ translate: "parkour.ui.cancel" }, () => {
            system.run(() => form.close());
        });
        form.closeButton();

        form.show().catch((error) => {
            console.warn(`[Parkour] Falha ao abrir confirmação do reset: ${error}`);
            player.sendMessage({ translate: "parkour.ui.settings.error" });
        });
    } catch (error) {
        console.warn(`[Parkour] Falha ao preparar confirmação do reset: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
    }
}

function isCreative(player) {
    try {
        return player.getGameMode() === GameMode.Creative;
    } catch (error) {
        console.warn(`[Parkour] Falha ao verificar modo de jogo de ${player.name}: ${error}`);
        player.sendMessage({ translate: "parkour.ui.settings.error" });
        return false;
    }
}

function createTenthOptions(minimumTenth, maximumTenth) {
    return Array.from(
        { length: maximumTenth - minimumTenth + 1 },
        (_, index) => {
            const value = (minimumTenth + index) / 10;
            return { label: value.toFixed(1), value };
        }
    );
}

function normalizeTenth(value) {
    return Math.round(value * 10) / 10;
}

import { world, system, GameMode, EquipmentSlot } from "@minecraft/server"; 
import { SettingsManager } from "./utils/settings_manager.js"; 
import "./utils/settings_ui.js";

import "./mechanics/dash.mechanics.js";
import "./mechanics/jump.air.skill.mechanics.js";
import "./mechanics/energetico.mechanics.js";
import "./mechanics/jump.fence.mechanics.js";
import "./mechanics/grab.mechanics.js";
import "./mechanics/gold_boot.mechanics.js";
import "./mechanics/infinity_ham.mechanics.js";
import "./mechanics/jump.air.skill.old.mechanics.js";
import "./mechanics/slide.mechanics.js";
import "./mechanics/crawl.mechanics.js";
import "./mechanics/wall_slide.mechanics.js";
import "./mechanics/attackmechanics.js";
import "./mechanics/footstep.mechanics.js";

export const ParkourConfig = {
    USOS_PARA_FOME: 4,
    DURACAO_EFEITO: 20
};

// --- NOVO: Sistema Centralizado de Peso da Armadura ---
export const ARMOR_HEAVINESS = {
    "minecraft:netherite_helmet": 0.1,
    "minecraft:netherite_chestplate": 0.1,
    "minecraft:netherite_leggings": 0.1,
    "minecraft:netherite_boots": 0.1
};

export function getKnockbackCompensation(p) {
    const equip = p.getComponent("minecraft:equippable");
    if (!equip) return 1;

    let resistance = 0;
    const slots = [
        EquipmentSlot.head || EquipmentSlot.Head,
        EquipmentSlot.chest || EquipmentSlot.Chest,
        EquipmentSlot.legs || EquipmentSlot.Legs,
        EquipmentSlot.feet || EquipmentSlot.Feet
    ];
    
    for (const slot of slots) {
        if (!slot) continue;
        let item;
        // Compatibilidade com diferentes versões da API do Bedrock
        if (typeof equip.getEquipmentSlot === 'function') {
            item = equip.getEquipmentSlot(slot)?.getItem();
        } else if (typeof equip.getEquipment === 'function') {
            item = equip.getEquipment(slot);
        }
        if (item) resistance += (ARMOR_HEAVINESS[item.typeId] || 0);
    }

    resistance = Math.min(resistance, 0.4);
    return resistance === 0 ? 1 : 1 / (1 - resistance);
}
// ------------------------------------------------------

const playerAbilityUsage = new Map();
const prewarmPending = new Set();

const BREATHE_PITCHES = [0.7, 0.75, 0.8, 0.85];
const BURP_PITCHES = [1.1, 1.15, 1.2, 1.25];
const BUBBLE_PITCHES = [0.8, 0.85, 0.9, 0.95];

export function registerAbilityUse(player) {
    if (!player || !player.isValid()) return;
    
    const debuffSettings = SettingsManager.getStatus(player.name).debuff;
    if (!debuffSettings.enabled) return;
    
    let usos = (playerAbilityUsage.get(player.id) || 0) + 1;
    
    if (usos >= ParkourConfig.USOS_PARA_FOME) {
        usos = 0;
        
        try {
            const gameMode = player.getGameMode();
            if (gameMode === GameMode.Creative || gameMode === GameMode.Spectator) {
                playerAbilityUsage.set(player.id, usos);
                return;
            }

            player.addEffect("hunger", ParkourConfig.DURACAO_EFEITO, { 
                amplifier: debuffSettings.level, 
                showParticles: false 
            });

            try {
                const loc = player.location;
                const centerLoc = { x: loc.x, y: loc.y + 1.0, z: loc.z };
                
                player.dimension.spawnParticle("parkour:particle.fadigue_bubble", centerLoc);
                
                const pBreathe = BREATHE_PITCHES[Math.floor(Math.random() * BREATHE_PITCHES.length)];
                const pBurp = BURP_PITCHES[Math.floor(Math.random() * BURP_PITCHES.length)];
                const pBubble = BUBBLE_PITCHES[Math.floor(Math.random() * BUBBLE_PITCHES.length)];

                player.dimension.playSound("mob.horse.breathe", player.location, { volume: 0.3, pitch: pBreathe }); 
                player.dimension.playSound("random.burp", player.location, { volume: 0.1, pitch: pBurp }); 
                player.dimension.playSound("bubble.pop", player.location, { volume: 0.2, pitch: pBubble });
            } catch(e) {}

        } catch(e) {
            console.warn("[Parkour] Erro silencioso: " + e.message);
        }
    } 
    playerAbilityUsage.set(player.id, usos);
}

export function getBlockSound(block) {
    const id = block?.typeId || '';
    if (id.includes('grass') || id.includes('mycelium') || id.includes('podzol') || id.includes('farmland') || id.includes('rooted_dirt') || id.includes('leaf') || id.includes('leaves') || id.includes('azalea')) return 'step.grass';
    if (id.includes('dirt') || id.includes('mud') || id.includes('gravel')) return 'step.gravel';
    if (id.includes('sand') || id.includes('sandstone')) return 'step.sand';
    if (id.includes('snow') || id.includes('powder_snow') || id.includes('packed_ice') || id.includes('blue_ice') || id.includes('ice')) return 'step.snow';
    if (id.includes('wood') || id.includes('plank') || id.includes('log') || id.includes('bamboo') || id.includes('hyphae') || id.includes('stem')) return 'step.wood';
    if (id.includes('glass') || id.includes('amethyst')) return 'step.stone';
    if (id.includes('wool') || id.includes('carpet') || id.includes('moss')) return 'step.cloth';
    if (id.includes('copper')) return 'step.copper';
    if (id.includes('netherrack') || id.includes('nether_brick') || id.includes('magma') || id.includes('soul_sand') || id.includes('soul_soil')) return 'step.nether_brick';
    if (id.includes('sculk')) return 'step.sculk';
    if (id.includes('iron') || id.includes('gold') || id.includes('chain') || id.includes('lantern')) return 'step.metal';
    if (id.includes('stone') || id.includes('cobblestone') || id.includes('brick') || id.includes('ore') || id.includes('deepslate') || id.includes('basalt') || id.includes('blackstone') || id.includes('andesite') || id.includes('diorite') || id.includes('granite') || id.includes('calcite') || id.includes('tuff') || id.includes('prismarine')) return 'step.stone';
    
    return 'step.stone';
}

world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn) {
        prewarmPending.add(ev.player.id);
        playerAbilityUsage.set(ev.player.id, 0); 
    }
});

world.afterEvents.playerLeave.subscribe((ev) => {
    playerAbilityUsage.delete(ev.playerId);
    prewarmPending.delete(ev.playerId);
});

system.runInterval(() => {
    if (prewarmPending.size === 0) return; 

    for (const player of world.getPlayers()) {
        if (!player.isValid()) continue;

        if (prewarmPending.has(player.id)) {
            const vel = player.getVelocity();
            if (Math.abs(vel.x) > 0.01 || Math.abs(vel.z) > 0.01) {
                prewarmPending.delete(player.id);
                player.playAnimation("animation.preview", { blendOutTime: 0.1 });
            }
        }
    }
});



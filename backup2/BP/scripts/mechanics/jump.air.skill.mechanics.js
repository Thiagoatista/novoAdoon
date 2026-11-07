import { world, system } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { registerAbilityUse, getKnockbackCompensation } from "../main.js";
import { stopSliding } from "./wall_slide.mechanics.js";

const MIN_FALL_DIST = 1.5; 
const DOUBLE_JUMP_FORCE = 0.6;
const INPUT_BUFFER_TICKS = 4;

const PITCH_VARIATIONS = [0.6, 0.65, 0.7, 0.75, 0.8];

const lastJumpState = new Map();
const fallStats = new Map();     
const jumpBuffer = new Map();    

function clearPlayerState(playerId) {
    lastJumpState.delete(playerId);
    fallStats.delete(playerId);
    jumpBuffer.delete(playerId);
}

world.afterEvents.playerLeave.subscribe((event) => {
    clearPlayerState(event.playerId);
});

system.runInterval(() => {
    const currentTick = system.currentTick;
    for (const player of world.getPlayers()) {
        if (!player.isValid) continue;
        
        if (!SettingsManager.enabled(player.name, 'air_jump')) {
            clearPlayerState(player.id);
            continue;
        }

        try {
            handleSkill(player, currentTick);
        } catch (e) {}
    }
});

function handleSkill(player, tick) {
    const playerId = player.id;
    const inWater = player.isInWater || player.isSwimming;
    
    const isGrabbing = player.hasTag("parkour_travado");

    let stats = fallStats.get(playerId);
    
    if (!stats || player.isOnGround || inWater || isGrabbing) {
        
        stats = { maxY: player.location.y, air: false, canDoubleJump: true };
        fallStats.set(playerId, stats);
        
        try { player.removeTag("parkour_double_jumped"); } catch(e){}
        
    } else {
        if (player.location.y > stats.maxY) stats.maxY = player.location.y;
        stats.air = true;
    }

    const isJumping = player.isJumping;
    const wasJumping = lastJumpState.get(playerId) || false;
    const jumpPressed = isJumping && !wasJumping;
    lastJumpState.set(playerId, isJumping);

    if (jumpPressed) {
        jumpBuffer.set(playerId, tick);
    }

    const lastPressTick = jumpBuffer.get(playerId) || -999;
    const hasBufferedInput = (tick - lastPressTick) <= INPUT_BUFFER_TICKS;
    const fallDistance = stats.maxY - player.location.y;

    if (hasBufferedInput && stats.air && fallDistance >= MIN_FALL_DIST && !isGrabbing && stats.canDoubleJump) {
        
        stats.canDoubleJump = false;
        
        performAction(player);
        jumpBuffer.delete(playerId); 
    }
}

function performAction(player) {
    // ===============================================
    // NOVA ADIÇÃO: Desativa o Slow Fall da Garra
    // ===============================================
    if (player.hasTag("garra_fallproof")) {
        player.removeTag("garra_fallproof");
        try { player.startItemCooldown("garra_mochila_cd", 1); } catch(e) {}
    }

    const compensation = getKnockbackCompensation(player);
    
    stopSliding(player);

    player.clearVelocity();
    
    player.applyKnockback({ x: 0, z: 0 }, DOUBLE_JUMP_FORCE * compensation);

    const stats = fallStats.get(player.id);
    if (stats) stats.maxY = player.location.y; 

    player.playAnimation("animation.player.air.jump", { blendOutTime: 0.2 });
    
    const pitchSorteado = PITCH_VARIATIONS[Math.floor(Math.random() * PITCH_VARIATIONS.length)];
    player.playSound("random.bow", { volume: 0.4, pitch: pitchSorteado }); 
    
    try {
        player.dimension.spawnParticle("parkour:know_particle_raio_choque", player.location);
        player.dimension.spawnParticle("parkour:know_particle_arq", player.location);
    } catch(e) {}
    
    player.addTag("parkour_double_jumped");
    
    registerAbilityUse(player);
}

import { world, system } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { registerAbilityUse } from "../main.js";
// Importação do scanner unificado
import { BlockScanner } from "../utils/abilities_scanners.js";

const MIN_FALL_DIST_OLD = 1.5; 
const MAX_FALL_DIST_OLD = 20.0;
const ACTIVATION_DIST_OLD = 1.5;
const COOLDOWN_TICKS_OLD = 15;
const INPUT_BUFFER_TICKS_OLD = 4;

const cooldownsOld = new Map();
const lastJumpStateOld = new Map();
const fallStatsOld = new Map();     
const jumpBufferOld = new Map();    
const pendingLanding = new Set(); 
const comboAwake = new Map(); 
const wallJumpState = new Set();

function clearPlayerState(playerId) {
    cooldownsOld.delete(playerId);
    lastJumpStateOld.delete(playerId);
    fallStatsOld.delete(playerId);
    jumpBufferOld.delete(playerId);
    pendingLanding.delete(playerId);
    comboAwake.delete(playerId);
    wallJumpState.delete(playerId);
}

world.afterEvents.playerLeave.subscribe((event) => {
    clearPlayerState(event.playerId);
});

system.runInterval(() => {
    const currentTick = system.currentTick;
    for (const player of world.getPlayers()) {
        if (!player.isValid) continue;
        
        if (!SettingsManager.enabled(player.name, 'air_jump_old')) {
            clearPlayerState(player.id);
            continue;
        }

        try {
            handleSkillOld(player, currentTick);
        } catch (error) {
            console.warn(`[Parkour] Falha na mecânica air_jump_old para ${player.name}: ${error}`);
        }
    }
});

function handleSkillOld(player, tick) {
    const playerId = player.id;
    const inWater = player.isInWater || player.isSwimming;
    
    const isWallSliding = player.hasTag("parkour_wall_sliding");
    const hasWallJumped = player.hasTag("parkour_wall_jumped");
    const wallJumpStarted = hasWallJumped && !wallJumpState.has(playerId);

    if (hasWallJumped) {
        wallJumpState.add(playerId);
    } else {
        wallJumpState.delete(playerId);
    }

    const bateuNoChao = player.isOnGround;

    if (bateuNoChao || inWater) {
        comboAwake.set(playerId, false); 
        
        try {
            player.removeTag("parkour_wall_jumped");
        } catch (error) {
            console.warn(`[Parkour] Falha ao remover a tag parkour_wall_jumped de ${player.name}: ${error}`);
        }

        if (pendingLanding.has(playerId)) {
            pendingLanding.delete(playerId);
            if (!inWater) {
                const pitches = [1.5, 1.7, 1.8, 2.0, 2.2, 2.4];
                const randomPitch = pitches[Math.floor(Math.random() * pitches.length)];
                
                player.dimension.playSound("stop_fall_sound", player.location, { volume: 0.1, pitch: randomPitch });
                try {
                    player.dimension.spawnParticle("parkour:stars_fall_stop", player.location);
                } catch (error) {
                    console.warn(`[Parkour] Falha ao gerar partículas de pouso para ${player.name}: ${error}`);
                }
                player.playAnimation("animation.player.fall.stop", { blendOutTime: 0.2 });
                registerAbilityUse(player);
            }
        }
    }

    let stats = fallStatsOld.get(playerId);
    if (!stats || bateuNoChao || inWater || isWallSliding) {
        stats = { maxY: player.location.y, air: false, pressCount: 0, playedErrorSound: false };
        fallStatsOld.set(playerId, stats);
    } else {
        if (player.location.y > stats.maxY) stats.maxY = player.location.y;
        stats.air = true;
    }

    if (isWallSliding) {
        jumpBufferOld.delete(playerId);
        stats.pressCount = 0;
        stats.playedErrorSound = false;
    }

    if (wallJumpStarted) {
        stats = { maxY: player.location.y, air: false, pressCount: 0, playedErrorSound: false };
        fallStatsOld.set(playerId, stats);
        jumpBufferOld.delete(playerId);
        cooldownsOld.delete(playerId);
        comboAwake.set(playerId, false);

        if (pendingLanding.delete(playerId)) {
            try {
                if (player.getEffect("resistance")?.amplifier === 255) {
                    player.removeEffect("resistance");
                }
            } catch (error) {
                console.warn(`[Parkour] Falha ao cancelar o fall safe ao saltar da parede para ${player.name}: ${error}`);
            }
        }
    }

    const isDoubleJumpEnabled = SettingsManager.enabled(player.name, 'air_jump');
    const hasUsedDoubleJump = player.hasTag("parkour_double_jumped");
    const canUseStop = isDoubleJumpEnabled ? hasUsedDoubleJump || hasWallJumped : true;

    let ignoredTick = false;

    if (isDoubleJumpEnabled) {
        if (!hasUsedDoubleJump && !hasWallJumped) {
            stats.maxY = player.location.y; 
            jumpBufferOld.delete(playerId); 
            stats.pressCount = 0; 
            stats.playedErrorSound = false;
            ignoredTick = true; 
        } else {
            if (!comboAwake.get(playerId)) {
                stats.maxY = player.location.y; 
                jumpBufferOld.delete(playerId); 
                stats.pressCount = 0; 
                stats.playedErrorSound = false;
                comboAwake.set(playerId, true); 
                ignoredTick = true; 
            }
        }
    }

    let isOnCooldown = false;
    if (cooldownsOld.has(playerId)) {
        let cd = cooldownsOld.get(playerId);
        if (cd > 0) { 
            cooldownsOld.set(playerId, cd - 1); 
            isOnCooldown = true;
        } else { 
            cooldownsOld.delete(playerId); 
        } 
    }

    const isJumping = player.isJumping;
    const wasJumping = lastJumpStateOld.get(playerId) || false;
    const jumpPressed = isJumping && !wasJumping;
    lastJumpStateOld.set(playerId, isJumping);

    const fallDistance = stats.maxY - player.location.y;

    if (jumpPressed && !ignoredTick) {
        if (stats.air && canUseStop && !isWallSliding) {
            if (fallDistance >= MIN_FALL_DIST_OLD) {
                stats.pressCount++;
                if (stats.pressCount === 1) {
                    jumpBufferOld.set(playerId, tick);
                } else {
                    jumpBufferOld.delete(playerId); 
                    if (!stats.playedErrorSound) {
                        player.playSound("note.bass", { volume: 1.0, pitch: 0.6 });
                        stats.playedErrorSound = true;
                    }
                }
            }
        }
    }

    const lastPressTick = jumpBufferOld.get(playerId) || -999;
    const hasBufferedInput = (tick - lastPressTick) <= INPUT_BUFFER_TICKS_OLD;

    if (!isWallSliding && !isOnCooldown && hasBufferedInput && stats.air && fallDistance >= MIN_FALL_DIST_OLD && canUseStop && stats.pressCount === 1) {
        
        // Chamando o BlockScanner central para calcular a distância do chão
        const groundDist = BlockScanner.scan(player, { needFallSafeGround: true }).fallSafeGround;
        
        if (groundDist > -1.0 && groundDist <= ACTIVATION_DIST_OLD) {
            if (fallDistance > MAX_FALL_DIST_OLD) {
                player.playSound("random.break", { volume: 1.0, pitch: 0.8 });
                player.onScreenDisplay.setActionBar({ translate: "parkour.message.fall.stop.fail" });
                jumpBufferOld.delete(playerId); 
            } else {
                performActionOld(player);
                jumpBufferOld.delete(playerId); 
            }
        }
    }
}

function performActionOld(player) {
    cooldownsOld.set(player.id, COOLDOWN_TICKS_OLD);
    const stats = fallStatsOld.get(player.id);
    if (stats) stats.maxY = player.location.y; 

    player.addEffect("resistance", 3, { amplifier: 255, showParticles: false });
    pendingLanding.add(player.id);
}

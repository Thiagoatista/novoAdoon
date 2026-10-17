import { world, system } from "@minecraft/server"; 
import { registerAbilityUse, getBlockSound, getKnockbackCompensation } from "../main.js"; 
import { SettingsManager } from "../utils/settings_manager.js"; 
import { BlockScanner } from "../utils/abilities_scanners.js";

const WALL_SLIDE_COOLDOWN_TICKS = 10;
const WALL_SLIDE_DOWN_FORCE = -0.07;

const slidingPlayers = new Map();
const slideFallStats = new Map(); 
const lastJumpStateSlide = new Map(); 
const slideCooldowns = new Map(); 
const slideAnimationStates = new Map();

world.afterEvents.playerLeave.subscribe((ev) => {
    slidingPlayers.delete(ev.playerId);
    slideFallStats.delete(ev.playerId);
    lastJumpStateSlide.delete(ev.playerId);
    slideCooldowns.delete(ev.playerId);
    slideAnimationStates.delete(ev.playerId);
    cancelFallProtection(`${ev.playerName}_wall_slide`);
});

let globalFallDamageEnabled = true;
const fallProtectionTimers = new Map();

function requestFallProtection(playerName, ticks) {
    fallProtectionTimers.set(playerName, system.currentTick + ticks);
    updateFallDamage();
}

function cancelFallProtection(playerName) {
    fallProtectionTimers.delete(playerName);
    updateFallDamage();
}

function updateFallDamage() {
    const currentTick = system.currentTick;
    let maxTick = 0;

    for (const [name, untilTick] of fallProtectionTimers.entries()) {
        if (currentTick >= untilTick) {
            fallProtectionTimers.delete(name);
        } else if (untilTick > maxTick) {
            maxTick = untilTick;
        }
    }

    if (maxTick > currentTick) {
        setFallDamage(false);
    } else {
        setFallDamage(true);
    }
}

function setFallDamage(enable) {
    if (globalFallDamageEnabled !== enable) {
        globalFallDamageEnabled = enable;
        try {
            world.getDimension('overworld').runCommandAsync(`gamerule falldamage ${enable}`);
        } catch (e) {}
    }
}

system.runInterval(() => updateFallDamage(), 15);

system.runInterval(() => {
    const tick = system.currentTick;
    for (const player of world.getPlayers()) {
        if (!player.isValid()) continue;

        if (!SettingsManager.enabled(player.name, 'wall_slide')) {
            if (slidingPlayers.has(player.id)) {
                stopSliding(player);
            }
            continue; 
        }

        handleWallSlide(player, tick);
    }
});

function handleWallSlide(player, tick) {
    const vel = player.getVelocity();
    const loc = player.location; 

    const isJumping = player.isJumping;
    const wasJumping = lastJumpStateSlide.get(player.id) || false;
    const jumpPressed = isJumping && !wasJumping;
    lastJumpStateSlide.set(player.id, isJumping);

    let fallTracker = slideFallStats.get(player.id);
    if (!fallTracker) {
        fallTracker = { maxY: loc.y };
        slideFallStats.set(player.id, fallTracker);
    }

    if (player.isOnGround || vel.y > 0) {
        fallTracker.maxY = loc.y;
    }

    const fallDistance = fallTracker.maxY - loc.y;
    
    const isSneakingDrop = player.isSneaking || player.hasTag("parkour_travado");
    
    if (player.isOnGround || vel.y > 0 || player.isSwimming || player.isInWater || isSneakingDrop) {
        stopSliding(player); 
        return;
    }

    if (slideCooldowns.has(player.id) && tick < slideCooldowns.get(player.id)) {
        return; 
    }

    if (!slidingPlayers.has(player.id) && (vel.y > -0.1 || fallDistance < 1.8)) {
        stopSliding(player);
        return;
    }

    // Chamando o BlockScanner central com a flag needWall
    const scanResult = BlockScanner.scan(player, tick, { needWall: true });
    const wallData = scanResult.wall;

    if (!wallData) {
        stopSliding(player);
        return;
    }

    const wallDir = wallData.dir;
    const wallBlock = wallData.block;

    if (jumpPressed && slidingPlayers.has(player.id)) {
        const canDoubleJump = SettingsManager.enabled(player.name, 'air_jump') && !player.hasTag("parkour_double_jumped");
        
        if (!canDoubleJump) {
            performWallJump(player, wallDir, wallBlock);
            return;
        }
    }

    if (!slidingPlayers.has(player.id)) {
        // ===============================================
        // NOVA ADIÇÃO: Desativa o Slow Fall da Garra
        // ===============================================
        if (player.hasTag("garra_fallproof")) {
            player.removeTag("garra_fallproof");
            try { player.startItemCooldown("garra_mochila_cd", 1); } catch(e) {}
        }

        slidingPlayers.set(player.id, { startTick: tick, lastStaminaTick: tick });
        
        try { 
            player.addTag("parkour_wall_sliding"); 
            
            const surfaceSound = getBlockSound(wallBlock);
            player.dimension.playSound(surfaceSound, loc, { volume: 0.8, pitch: 0.5 });
            
            player.playAnimation("animation.wall_slide.start");
            slideAnimationStates.set(player.id, { phase: 'start', startTick: tick, lastPlay: tick });
        } catch(e){}

        const protectName = `${player.name}_wall_slide`;
        cancelFallProtection(protectName);
        requestFallProtection(protectName, 999999); 
    }

    const slideData = slidingPlayers.get(player.id);

    try {
        const compensation = getKnockbackCompensation(player);
        
        player.applyKnockback(
            0, 
            0, 
            0, 
            WALL_SLIDE_DOWN_FORCE * compensation
        );

    } catch (e) {}

    handleSlideAnimation(player, tick);

    if ((tick - slideData.startTick) % 20 === 0 && tick !== slideData.startTick) {
        try {
            const surfaceSound = getBlockSound(wallBlock);
            player.dimension.playSound(surfaceSound, loc, { volume: 0.6, pitch: 0.8 });
            
            const blockId = wallBlock.typeId || "";
            if (blockId.includes('leaves') || blockId.includes('leaf') || blockId.includes('azalea')) {
                player.dimension.playSound('dig.grass', loc, { pitch: 1.0, volume: 0.5 });
            }
        } catch (e) {}
    }

    if (tick % 2 === 0) {
        try {
            player.dimension.spawnParticle("parkour:smoke_wall_slide", {
                x: loc.x + wallDir.x * 0.2,
                y: loc.y + 0.5, 
                z: loc.z + wallDir.z * 0.2
            });
        } catch (e) {}
    }

    if (tick - slideData.lastStaminaTick >= 30) {
        registerAbilityUse(player);
        slideData.lastStaminaTick = tick;
    }
}

function handleSlideAnimation(player, tick) {
    const state = slideAnimationStates.get(player.id);
    if (!state) return;
    
    if (state.phase === 'start' && (tick - state.startTick >= 14)) {
        try { player.playAnimation("animation.wall_slide.loop"); } catch(e){}
        Object.assign(state, { phase: 'loop', lastPlay: tick });
    } 
    else if (state.phase === 'loop' && (tick - state.lastPlay >= 14)) {
        try { player.playAnimation("animation.wall_slide.loop"); } catch(e){}
        state.lastPlay = tick;
    }
}

function performWallJump(player, wallDir, wallBlock) { 
    const loc = player.location;
    stopSliding(player, true);
    
    slideCooldowns.set(player.id, system.currentTick + WALL_SLIDE_COOLDOWN_TICKS);

    try { player.clearVelocity(); } catch(e){}
    try { player.addTag("parkour_wall_jumped"); } catch(e){} 
    
    try {
        const compensation = getKnockbackCompensation(player);
        
        player.applyKnockback(-wallDir.x, -wallDir.z, 0.6 * compensation, 0.6 * compensation);
        
        const jumpSound = wallBlock ? getBlockSound(wallBlock) : "step.stone";
        player.dimension.playSound(jumpSound, player.location, { volume: 0.8, pitch: 1.0 }); 

        player.playAnimation("animation.wall.slide.jump", { blendOutTime: 0.2 });
        player.dimension.spawnParticle("parkour:wall_slide_debris", {
            x: loc.x + wallDir.x * 0.1,
            y: loc.y + 1.2, 
            z: loc.z + wallDir.z * 0.1
        });
    } catch(e) {}
    
    registerAbilityUse(player);
}

export function stopSliding(player, isWallJump = false) {
    if (slidingPlayers.has(player.id)) {
        slidingPlayers.delete(player.id);

        try { 
            player.removeTag("parkour_wall_sliding"); 
            player.addTag("parkour_slide_grace");
            system.runTimeout(() => {
                try { player.removeTag("parkour_slide_grace"); } catch(e){}
            }, 2);
        } catch(e){}

        const protectName = `${player.name}_wall_slide`;
        cancelFallProtection(protectName);
        requestFallProtection(protectName, 10);

        const state = slideAnimationStates.get(player.id);
        if (state && !isWallJump) {
            try { player.playAnimation("animation.wall_slide.end", { blendOutTime: 0.2 });
            } catch(e){}
        }
        slideAnimationStates.delete(player.id);
    }
}

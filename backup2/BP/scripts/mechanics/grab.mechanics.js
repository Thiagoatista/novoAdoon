import { world, system } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { registerAbilityUse, getBlockSound, getKnockbackCompensation } from "../main.js";
// Importando o novo scanner mesclado
import { BlockScanner } from "../utils/abilities_scanners.js";

const TAG_TRAVADO = "parkour_travado";
const grudados = new Set();
const cooldowns = new Map();
const holdPositions = new Map();
const lastSneakState = new Map();
const sneakPressedAirborne = new Map();
const canGrab = new Map();
const animationStates = new Map(); 

function isInLiquid(player) {
    if (player.isInWater || player.isSwimming) return true;

    try {
        const loc = player.location;
        const headLoc = { x: Math.floor(loc.x), y: Math.floor(loc.y + 1.3), z: Math.floor(loc.z) };
        
        const headBlock = player.dimension.getBlock(headLoc);
        return headBlock?.isLiquid || headBlock?.isWaterlogged || false;
    } catch (e) {
        return false;
    }
}

world.afterEvents.playerSpawn.subscribe((ev) => {
    const player = ev.player;
    try {
        player.removeTag(TAG_TRAVADO);
        grudados.delete(player.id);
        holdPositions.delete(player.id);
        animationStates.delete(player.id); 
        canGrab.set(player.id, true);
    } catch (e) {}
});

world.afterEvents.playerLeave.subscribe((ev) => {
    grudados.delete(ev.playerId);
    cooldowns.delete(ev.playerId);
    holdPositions.delete(ev.playerId);
    lastSneakState.delete(ev.playerId);
    sneakPressedAirborne.delete(ev.playerId);
    canGrab.delete(ev.playerId);
    animationStates.delete(ev.playerId);
});

system.runInterval(() => {
    const currentTick = system.currentTick; 
    
    for (const player of world.getPlayers()) {
        if (!player.isValid) continue;

        if (!SettingsManager.enabled(player.name, 'grab')) {
            if (grudados.has(player.id)) endGrab(player, currentTick, false);
            continue;
        }

        try {
            updateGrabReset(player);
            trackSneakInput(player);
            gerenciarParkour(player, currentTick); 
        } catch (e) { }
    }
});

function updateGrabReset(player) {
    if (player.isOnGround || player.isJumping) {
        canGrab.set(player.id, true);
    }
}

function trackSneakInput(player) {
    const sneaking = player.isSneaking;
    const lastSneak = lastSneakState.get(player.id) || false;
    const sneakPressed = sneaking && !lastSneak;

    if (player.isOnGround) {
        sneakPressedAirborne.set(player.id, false);
    } else if (sneakPressed) {
        sneakPressedAirborne.set(player.id, true);
    }
    lastSneakState.set(player.id, sneaking);
}

function gerenciarParkour(player, tick) {
    const playerId = player.id;

    if (cooldowns.has(playerId)) {
        let tempo = cooldowns.get(playerId);
        if (tempo > 0) { 
            cooldowns.set(playerId, tempo - 1); 
            return; 
        } else { 
            cooldowns.delete(playerId); 
        }
    }

    if (grudados.has(playerId)) {
        handleActive(player, tick);
    } else {
        checkForGrab(player, tick);
    }
}

function checkForGrab(player, tick) {
    const playerId = player.id;

    const allowed = canGrab.has(playerId) ? canGrab.get(playerId) : true;
    if (!allowed) return;

    if (player.hasTag("parkour_aqua_lock") || player.hasTag("parkour_dash_active")) return;

    const validSneak = sneakPressedAirborne.get(playerId);
    
    if (!validSneak || !player.isSneaking || player.isOnGround) return;
    
    if (isInLiquid(player)) return;

    // Chamando o BlockScanner central com as flags de ledge e a nova flag de escada
    const scanResult = BlockScanner.scan(player, { 
        needLedge: true, 
        lenientLedge: false,
        needClimbableCheck: true
    });
    
    // Se o scanner disser que está numa escada ou vinha, aborta a missão!
    if (scanResult.isClimbable) return;
    
    const grabbedBlock = scanResult.ledge;
    
    if (grabbedBlock) {
        startGrab(player, tick, grabbedBlock);
    }
}

function startGrab(player, tick, block) {
    const playerId = player.id;
    grudados.add(playerId);
    
    // ===============================================
    // NOVA ADIÇÃO: Desativa o Slow Fall da Garra
    // ===============================================
    if (player.hasTag("garra_fallproof")) {
        player.removeTag("garra_fallproof");
        try { player.startItemCooldown("garra_mochila_cd", 1); } catch(e) {}
    }
    
    player.clearVelocity();
    player.applyKnockback({ x: 0, z: 0 }, 0);
    
    holdPositions.set(playerId, player.location.y);
    
    if (player.hasTag("parkour_wall_sliding") || player.hasTag("parkour_slide_grace")) {
        try { player.playAnimation("animation.wall_slide_transicao_grab.start"); } catch(e){}
        player.removeTag("parkour_wall_sliding");
        player.removeTag("parkour_slide_grace"); 
    } else {
        player.playAnimation("animation.player.wall_hold.start");
    }
    
    const comp = getKnockbackCompensation(player);
    animationStates.set(playerId, { 
        phase: 'start', 
        startTick: tick, 
        lastPlay: tick, 
        messageShown: false,
        compensation: comp 
    });
    
    player.dimension.playSound("game.player.attack.strong", player.location, { pitch: 0.8, volume: 0.5 });
    
    if (block) {
        const surfaceSound = getBlockSound(block);
        player.dimension.playSound(surfaceSound, player.location, { pitch: 1.0, volume: 1.0 });

        const blockId = block.typeId || "";
        if (blockId.includes('leaves') || blockId.includes('leaf') || blockId.includes('azalea')) {
            player.dimension.playSound('dig.grass', player.location, { pitch: 1.0, volume: 0.5 });
        }
    }
    
    player.addTag(TAG_TRAVADO);
    sneakPressedAirborne.set(playerId, false);
    
    registerAbilityUse(player);
}

function handleActive(player, tick) {
    // 1. PRIORIDADE: Soltou o botão? Pula AGORA! Sem atrasos.
    if (!player.isSneaking) {
        performPullUp(player, tick); 
        return;
    }

    // 2. Chamando o BlockScanner com flags lenientes e checando a escada novamente
    const scanResult = BlockScanner.scan(player, { 
        needLedge: true, 
        lenientLedge: true,
        needClimbableCheck: true
    });
    
    const temParede = !!scanResult.ledge;

    // 3. Trava ambiental (Água, Dash, ou se colocaram uma escada no jogador)
    if (isInLiquid(player) || scanResult.isClimbable || player.hasTag("parkour_aqua_lock") || player.hasTag("parkour_dash_active")) {
        endGrab(player, tick, false); 
        return;
    }

    if (player.isOnGround || !temParede) {
        endGrab(player, tick, false); 
        return;
    }

    const state = animationStates.get(player.id);
    if (state) {
        const tempoGrudado = tick - state.startTick;
        
        if (tempoGrudado >= 200) {
            if (!state.messageShown) {
                player.onScreenDisplay.setActionBar({ translate: "parkour.message.failsafe" });
                state.messageShown = true;
            }
            
            if (player.isJumping) {
                endGrab(player, tick, false); 
                return;
            }
        }
    }

    handleAnimation(player, tick);
    maintainHold(player);
}

function handleAnimation(player, tick) {
    const state = animationStates.get(player.id);
    if (!state) return;
    
    if (state.phase === 'start' && (tick - state.startTick >= 9)) {
        player.playAnimation("animation.player.wall_hold.loop");
        Object.assign(state, { phase: 'loop', lastPlay: tick });
    } 
    else if (state.phase === 'loop' && (tick - state.lastPlay >= 9)) {
        player.playAnimation("animation.player.wall_hold.loop");
        state.lastPlay = tick;
    }
}

function maintainHold(player) {
    const holdY = holdPositions.get(player.id);
    if (holdY === undefined) return;

    const currentY = player.location.y;
    const dy = holdY - currentY;

    const gravityOffset = 0.08; 
    let appliedForce = gravityOffset;

    if (dy > 0.01) {
        appliedForce = gravityOffset + (dy * 1.2);
    } else if (dy < -0.01) {
        appliedForce = gravityOffset + (dy * 0.6);
    }

    appliedForce = Math.max(0, Math.min(0.5, appliedForce));

    const state = animationStates.get(player.id);
    const compensation = state ? state.compensation : 1;
    
    player.applyKnockback({ x: 0, z: 0 }, appliedForce * compensation);
}

function performPullUp(player, tick) {
    player.playAnimation("animation.player.wall_jump", { blendOutTime: 0.1 });
    
    const state = animationStates.get(player.id);
    const compensation = state ? state.compensation : getKnockbackCompensation(player);

    player.applyKnockback({ x: 0, z: 0 }, 0.6 * compensation);
    player.dimension.playSound("game.player.attack.strong", player.location, { pitch: 1.2, volume: 0.7 });
    
    const view = typeof player.getViewDirection === 'function' ? player.getViewDirection() : player.viewDirection;
    if (Math.abs(view.x) > 0 || Math.abs(view.z) > 0) {
        player.applyImpulse({ x: view.x * 0.35, y: 0, z: view.z * 0.35 });
    }

    canGrab.set(player.id, true);
    endGrab(player, tick, true); 
}

function endGrab(player, tick, isPullUp = false) {
    const playerId = player.id;
    
    const state = animationStates.get(playerId); 
    const animStartTick = state ? state.startTick : 0;

    grudados.delete(playerId);
    holdPositions.delete(playerId);
    animationStates.delete(playerId); 
    sneakPressedAirborne.delete(playerId);
    lastSneakState.delete(playerId);

    const cooldownTime = isPullUp ? 6 : 8; 
    cooldowns.set(playerId, cooldownTime);

    if (!isPullUp) {
        player.clearVelocity();
    }

    if (!isPullUp && (tick - animStartTick >= 9)) {
        player.playAnimation("animation.player.wall_hold.end", { blendOutTime: 0.1 });
    }

    player.removeTag(TAG_TRAVADO);
}

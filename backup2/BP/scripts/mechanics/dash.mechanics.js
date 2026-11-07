import { world, system } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { registerAbilityUse, getKnockbackCompensation, getBlockSound } from "../main.js";
import { BlockScanner } from "../utils/abilities_scanners.js";

// FORÇAS DO DASH TERRESTRE
const TAP_LIMIT_MS = 300; 
const AQUA_BOOST_FORCE = 0.45;

const AQUA_START_TICKS = 13; 

const DASH_ANIM_TICKS = 8; 

const AQUA_PARTICLE_BACK = 1.15;   
const AQUA_PARTICLE_HEIGHT = 0.25; 
const AQUA_PARTICLE_WIDTH = 0.23; 
const AQUA_PARTICLE_DELAY_TICKS = 2; 

const DASH_COOLDOWN_TAG = "dash_cd"; 

const sneakStartTimes = new Map();
const wasSneaking = new Map();
const isAquaDashing = new Map(); 
const aquaState = new Map();
const sprintMemory = new Map(); 
const dashStats = new Map();
const landDashIframes = new Map();

function clearPlayerState(playerId) {
    sneakStartTimes.delete(playerId);
    wasSneaking.delete(playerId);
    isAquaDashing.delete(playerId);
    aquaState.delete(playerId);
    sprintMemory.delete(playerId);
    dashStats.delete(playerId);
    landDashIframes.delete(playerId);
}

world.beforeEvents.entityHurt.subscribe((event) => {
    const hurtEntity = event.hurtEntity;
    if (hurtEntity.typeId !== "minecraft:player") return;

    const protectionEndTick = landDashIframes.get(hurtEntity.id);
    if (protectionEndTick === undefined) return;

    if (system.currentTick >= protectionEndTick) {
        landDashIframes.delete(hurtEntity.id);
        return;
    }

    event.cancel = true;
});

world.afterEvents.playerSpawn.subscribe((ev) => {
    const player = ev.player;
    try {
        player.removeTag(DASH_COOLDOWN_TAG);
        player.removeTag("parkour_aqua_lock");
        player.removeTag("parkour_dash_active");
        
        sneakStartTimes.delete(player.id);
        wasSneaking.set(player.id, false);
        isAquaDashing.set(player.id, false);
        aquaState.delete(player.id);
        sprintMemory.delete(player.id);
        dashStats.delete(player.id);
        landDashIframes.delete(player.id);
    } catch (e) {}
});

world.afterEvents.playerLeave.subscribe((ev) => {
    clearPlayerState(ev.playerId);
});

system.runInterval(() => {
    const currentTick = system.currentTick;
    const players = typeof world.getAllPlayers === 'function' ? world.getAllPlayers() : world.getPlayers();

    for (const player of players) {
        try {
            if (!player.isValid) continue;

            const wasDashing = isAquaDashing.get(player.id) || false;

            if (player.isInWater && player.isSwimming) {
                if (SettingsManager.enabled(player.name, 'aqua_dash')) {
                    handleAquaDash(player, currentTick);
                } else if (wasDashing) {
                    stopAquaDash(player);
                }
                
                sneakStartTimes.delete(player.id);
                wasSneaking.set(player.id, player.isSneaking);
            } 
            else {
                if (wasDashing) {
                    stopAquaDash(player); 
                }
            }
            
            handleLandDash(player, currentTick);
            
            if (player.isSprinting) {
                sprintMemory.set(player.id, currentTick);
            }
            
        } catch (e) {}
    }
});

function finalizarDashNoChao(player, interrompido = false) {
    const stats = dashStats.get(player.id);
    if (!stats) return;

    stats.emAcao = false;
    stats.tickInicial = null;

    if (interrompido && stats.tipoAnimacao) {
        player.playAnimation(`animation.player.dash.${stats.tipoAnimacao}.end`, { blendOutTime: 0.1 });
    }
}

function handleAquaDash(player, tick) {
    const isSneaking = player.isSneaking;
    const wasDashing = isAquaDashing.get(player.id) ?? false;
    let state = aquaState.get(player.id);

    if (!player.isInWater || !player.isSwimming || !isSneaking) {
        if (wasDashing) stopAquaDash(player);
        return;
    }

    if (BlockScanner.scan(player, { needDashFrontalCollision: true }).dashFrontalCollision) {
        if (wasDashing) stopAquaDash(player);
        return; 
    }

    if (!wasDashing) {
        player.dimension.playSound("ambient.underwater.enter", player.location, { volume: 0.8, pitch: 1.2 });
        isAquaDashing.set(player.id, true);
        registerAbilityUse(player); 
        state = { startTick: tick, phase: 'start', compensation: getKnockbackCompensation(player) };
        aquaState.set(player.id, state);

        player.addTag("parkour_aqua_lock");
        player.playAnimation("animation.comeco.aqua.dash", { stopExpression: "!query.is_sneaking" });
    }

    if (state) {
        if (state.phase === 'start' && (tick - state.startTick >= AQUA_START_TICKS)) {
            player.playAnimation("animation.aqua.dash.ciclo", { stopExpression: "!query.is_sneaking" });
            state.phase = 'loop';
        } 
    }

    const viewDir = typeof player.getViewDirection === 'function' ? player.getViewDirection() : player.viewDirection;
    const currentVel = typeof player.getVelocity === 'function' ? player.getVelocity() : player.velocity;
    const currentSpeed = Math.hypot(currentVel.x, currentVel.z);
    
    if (currentSpeed < 0.55) {
        const FORCA_NADO = 0.45; 
        let verticalBoost = viewDir.y * FORCA_NADO * 0.5;

        if (BlockScanner.scan(player, { needDashGap: true }).dashGap) {
            verticalBoost += 0.3; 
        }

        const compensation = state ? state.compensation : 1;
        
        if (Math.hypot(viewDir.x, viewDir.z) > 0.1) {
            player.applyKnockback(
                { x: viewDir.x * FORCA_NADO * compensation, z: viewDir.z * FORCA_NADO * compensation },
                verticalBoost * compensation
            );
        } else {
            player.applyKnockback({ x: 0, z: 0 }, (verticalBoost * 1.2) * compensation);
        }
    }
    
    if (state && (tick - state.startTick >= AQUA_PARTICLE_DELAY_TICKS)) {
        spawnAquaParticlesRotated(player, tick);
    }
}

function stopAquaDash(player) {
    isAquaDashing.set(player.id, false);
    aquaState.delete(player.id);
    player.removeTag("parkour_aqua_lock");
    player.playAnimation("animation.aqua.dash.final", { blendOutTime: 0.2 });
    if (player.isValid) player.dimension.playSound("ambient.underwater.exit", player.location, { volume: 0.5, pitch: 1.0 });
}

function spawnAquaParticlesRotated(player, tick) {
    try {
        const headLoc = player.getHeadLocation();
        const viewDir = typeof player.getViewDirection === 'function' ? player.getViewDirection() : player.viewDirection;
        const rotY = player.getRotation().y;
        const DISTANCIA_PE = 1.6;
        const centerX = headLoc.x - (viewDir.x * DISTANCIA_PE), centerY = headLoc.y - (viewDir.y * DISTANCIA_PE), centerZ = headLoc.z - (viewDir.z * DISTANCIA_PE); 
        const bodyYawRad = rotY * (Math.PI / 180), rightX = -Math.cos(bodyYawRad), rightZ = -Math.sin(bodyYawRad);
        const leftLegPos = { x: centerX - (rightX * AQUA_PARTICLE_WIDTH), y: centerY, z: centerZ - (rightZ * AQUA_PARTICLE_WIDTH) };
        const rightLegPos = { x: centerX + (rightX * AQUA_PARTICLE_WIDTH), y: centerY, z: centerZ + (rightZ * AQUA_PARTICLE_WIDTH) };

        player.dimension.spawnParticle("parkour:micro_ondas", leftLegPos);
        player.dimension.spawnParticle("parkour:micro_ondas", rightLegPos);
        
        if (tick % 4 === 0) {
            player.dimension.spawnParticle("parkour:aqua_motor_bolhas", leftLegPos);
            player.dimension.spawnParticle("parkour:aqua_motor_bolhas", rightLegPos);
        }
        if (tick % 3 === 0) {
            player.dimension.spawnParticle("parkour:aqua_motor_bolhas_pulse", leftLegPos);
            player.dimension.spawnParticle("parkour:aqua_motor_bolhas_pulse", rightLegPos);
            const spread = 0.8;
            const bodyBubblePos = { x: player.location.x + (Math.random() - 0.5) * spread, y: player.location.y + 0.5 + (Math.random() - 0.5) * spread, z: player.location.z + (Math.random() - 0.5) * spread };
            player.dimension.spawnParticle("minecraft:bubble_column_up_particle", bodyBubblePos);
        }
    } catch (e) {}
}

function handleLandDash(player, currentTick) {
    const playerId = player.id;
    const inWater = player.isInWater || player.isSwimming;
    const isGrabbing = player.hasTag("parkour_travado");

    let dStats = dashStats.get(playerId);
    if (!dStats) {
        dStats = { emAcao: false, tickInicial: null, tipoAnimacao: null };
        dashStats.set(playerId, dStats);
    }

    if (dStats.emAcao && (inWater || isGrabbing)) {
        finalizarDashNoChao(player, true);
    }

    if (dStats.emAcao) {
        if (currentTick - dStats.tickInicial >= DASH_ANIM_TICKS) {
            finalizarDashNoChao(player, false);
        }
    }

    if (inWater || !SettingsManager.enabled(player.name, 'land_dash')) return;

    const isSneaking = player.isSneaking;
    const previousState = wasSneaking.get(playerId) ?? false;
    const lastSprint = sprintMemory.get(playerId) || 0;
    const recentlySprinted = (currentTick - lastSprint) <= 3;

    if (SettingsManager.enabled(player.name, 'slide') && recentlySprinted) {
        sneakStartTimes.delete(playerId);
    } else {
        if (isSneaking && !previousState) {
            sneakStartTimes.set(playerId, Date.now());
        }
        else if (!isSneaking && previousState) {
            const pressTime = sneakStartTimes.get(playerId);
            if (pressTime) {
                const duration = Date.now() - pressTime;
                if (duration < TAP_LIMIT_MS && !dStats.emAcao) {
                    performLandDash(player, currentTick, dStats);
                }
            }
        }
    }
    
    wasSneaking.set(playerId, isSneaking);
}

function performLandDash(player, currentTick, dStats) {
    const playerId = player.id;
    if (player.hasTag(DASH_COOLDOWN_TAG)) return;
    if (!player.isOnGround) return;

    const dashSettings = SettingsManager.getStatus(player.name).land_dash;
    const velocity = typeof player.getVelocity === 'function' ? player.getVelocity() : player.velocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    
    if (speed < 0.05) return;

    const viewDir = typeof player.getViewDirection === 'function' ? player.getViewDirection() : player.viewDirection;

    player.addTag(DASH_COOLDOWN_TAG);

    player.addTag("parkour_dash_active");

    system.runTimeout(() => {
        if (player.isValid) player.removeTag("parkour_dash_active");
    }, 10);

    const viewMag = Math.hypot(viewDir.x, viewDir.z);
    if (viewMag < 0.001) return; 

    const immunityTicks = Math.round(dashSettings.immunitySeconds * 20);
    landDashIframes.delete(playerId);
    if (immunityTicks > 0) {
        const protectionEndTick = currentTick + immunityTicks;
        landDashIframes.set(playerId, protectionEndTick);
        system.runTimeout(() => {
            if (landDashIframes.get(playerId) === protectionEndTick) {
                landDashIframes.delete(playerId);
            }
        }, immunityTicks);
    }
    
    const forwardX = viewDir.x / viewMag, forwardZ = viewDir.z / viewMag;
    const rightX = -forwardZ, rightZ = forwardX;

    const moveZ = (velocity.x * forwardX) + (velocity.z * forwardZ); 
    const moveX = (velocity.x * rightX) + (velocity.z * rightZ);     

    const angle = Math.atan2(moveZ, moveX);
    const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);

    const snapMoveX = Math.cos(snapAngle), snapMoveZ = Math.sin(snapAngle);
    const finalDirX = snapMoveZ * forwardX + snapMoveX * rightX;
    const finalDirZ = snapMoveZ * forwardZ + snapMoveX * rightZ;

    const deg = Math.round(snapAngle * (180 / Math.PI));
    
    let appliedForce = dashSettings.upDownForce; 
    let dashType = "forward";

    if (deg === 90 || deg === 45 || deg === 135) {
        dashType = "forward";
        appliedForce = dashSettings.upDownForce;
    } else if (deg === -90 || deg === -45 || deg === -135) {
        dashType = "backward";
        appliedForce = dashSettings.upDownForce;
    } else {
        dashType = "forward";
        appliedForce = dashSettings.sideForce;
    }

    dStats.emAcao = true;
    dStats.tickInicial = currentTick;
    dStats.tipoAnimacao = dashType;

    player.playAnimation(`animation.player.dash.${dashType}`, { blendOutTime: 0.1 });

    const compensation = getKnockbackCompensation(player);
    player.applyKnockback(
        { x: finalDirX * appliedForce * compensation, z: finalDirZ * appliedForce * compensation },
        dashSettings.verticalForce * compensation
    );
    
    spawnDashEffects(player, currentTick);
    registerAbilityUse(player);

    system.runTimeout(() => {
        if (player.isValid) player.removeTag(DASH_COOLDOWN_TAG);
    }, Math.round(dashSettings.cooldownSeconds * 20));
}

function spawnDashEffects(player, currentTick) {
    try { 
        const scanResult = BlockScanner.scan(player, { needBlockBelowCheck: true });
        
        if (scanResult.blockBelow) {
            const soundName = getBlockSound(scanResult.blockBelow);
            player.dimension.playSound(soundName, player.location, { volume: 1.2, pitch: 0.9 });
            player.dimension.playSound(soundName, player.location, { volume: 1, pitch: 1.1 });
        }

        player.dimension.playSound("game.player.attack.strong", player.location, { volume: 0.6, pitch: 1.5 });
        
        player.dimension.spawnParticle("parkour:roll_debris", player.location);
    } catch(e){}
}

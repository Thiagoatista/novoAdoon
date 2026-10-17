import { world, system, EntityComponentTypes, EntityDamageCause } from "@minecraft/server";
import { BlockScanner } from "../utils/abilities_scanners.js";

const grapplingHookData = {};
const animationStates = new Map();

// Configurações do Puxão de Entidade (Mobs)
const MOB_PULL_STOP_DISTANCE = 3.0;
const MOB_PULL_STOP_BUFFER = 0.10;
const MOB_PULL_TARGET_SPEED = 0.88;
const MOB_PULL_MAX_ACCEL_IMPULSE = 0.288;

// Cooldown gigante para manter a garra travada SOMENTE enquanto puxa entidade (~27 minutos, máximo do jogo)
const COOLDOWN_TRAVADO_TICKS = 32767;

// Entidades imunes a serem puxadas
const UNHOOKABLE_ENTITY_TYPES = new Set([
    "minecraft:player",
    "minecraft:armor_stand",
    "parkour:garra_projectile"
]);

// Chefões e Mobs grandes (O gancho bate e volta sem puxar)
const DAMAGE_ONLY_ENTITY_TYPES = new Set([
    "minecraft:ender_dragon",
    "minecraft:wither",
    "minecraft:warden",
    "minecraft:ravager",
    "minecraft:elder_guardian",
    "minecraft:iron_golem",
    "minecraft:ghast",
    "minecraft:happy_ghast",
    "minecraft:sniffer"
]);

// Helper para validar entidades com segurança em qualquer versão da Script API
function checkEntityValid(entity) {
    if (!entity) return false;
    try {
        return typeof entity.isValid === 'function' ? entity.isValid() : Boolean(entity.isValid);
    } catch (e) {
        return false;
    }
}

// ==========================================
// FUNÇÕES VETORIAIS
// ==========================================
const vector = {
    sum: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    subtract: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    multiply: (a, scalar) => ({ x: a.x * scalar, y: a.y * scalar, z: a.z * scalar }),
    distance: (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
    length: (v) => Math.hypot(v.x, v.y, v.z),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    normalize: (v) => {
        const len = Math.hypot(v.x, v.y, v.z);
        return len > 0.0001 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 };
    },
    moveTowards: (from, to, maxStep) => {
        const delta = vector.subtract(to, from);
        const remaining = vector.distance(from, to);
        if (remaining <= Math.max(0, maxStep)) return { x: to.x, y: to.y, z: to.z };
        return vector.sum(from, vector.multiply(delta, maxStep / remaining));
    }
};

// ==========================================
// CANCELAMENTO AO MORRER / SAIR DO MUNDO
// ==========================================
world.afterEvents.playerSpawn.subscribe((ev) => {
    const player = ev.player;
    try {
        animationStates.delete(player.id);
        player.removeTag("garra_fallproof");
    } catch (e) {}
});

world.afterEvents.entityDie.subscribe((ev) => {
    if (ev.deadEntity.typeId === "minecraft:player") {
        stopGrapplingEvent(ev.deadEntity.id, null, ev.deadEntity);
        ev.deadEntity.removeTag("garra_fallproof");
        animationStates.delete(ev.deadEntity.id);
    }
});

world.afterEvents.playerLeave.subscribe((ev) => {
    stopGrapplingEvent(ev.playerId);
    animationStates.delete(ev.playerId);
});

// ==========================================
// PROTEÇÃO CONTRA DANO DE QUEDA E DESLIGAMENTO DA MOCHILA
// ==========================================
system.runInterval(() => {
    const tick = system.currentTick;
    for (const player of world.getPlayers({ tags: ["garra_fallproof"] })) {
        if (checkEntityValid(player)) {
            const scanResult = BlockScanner.scan(player, tick, { needSpectralWaterCheck: true });
            const inWater = scanResult.spectralWaterCheck || player.isInWater || player.isSwimming;

            if (player.isOnGround || inWater) {
                player.removeTag("garra_fallproof");
                try { player.startItemCooldown("garra_mochila_cd", 1); } catch(e) {}
            } else {
                player.addEffect("slow_falling", 2, { amplifier: 200, showParticles: false });
            }
        }
    }
}, 3);

// ==========================================
// PROTEÇÃO ANTI-CLIQUE NA CORDA
// ==========================================
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
    if (ev.target && ev.target.typeId === "parkour:garra_projectile") {
        ev.cancel = true; 
    }
});

// ==========================================
// GERENCIADOR DE ANIMAÇÕES DA GARRA
// ==========================================
function handleGrappleAnimation(player, tick) {
    const state = animationStates.get(player.id);
    if (!state) return;
    
    const ticksPassed = tick - state.startTick;

    if (state.phase === 'inicio' && ticksPassed >= 12) {
        state.phase = 'loop';
        state.lastLoopTick = tick - 9; 
    }

    if (state.phase === 'loop') {
        if (tick - state.lastLoopTick >= 9) {
            player.playAnimation("animation.default_player_grapple_inicio_loop", { 
                controller: "camada_braco"
            });
            state.lastLoopTick = tick;
        }
    }
}

// ==========================================
// GRAPPLING HOOK
// ==========================================
world.afterEvents.itemUse.subscribe((ev) => {
    const player = ev.source;
    const itemStack = ev.itemStack;

    if (itemStack.typeId === "parkour:garra_suspeita") {
        grapplingHookShoot(player, itemStack);
    }
});

function grapplingHookShoot(source, itemStack) {
    const playerId = source.id;
    const currentTick = system.currentTick;
    
    if (grapplingHookData[playerId]) {
        if (grapplingHookData[playerId].phase === "MOB_PULL") {
            grapplingHookData[playerId].phase = "RETURNING";
        }
        return;
    }

    if (source.getItemCooldown("garra_ataque_cd") > 0) return;

    source.startItemCooldown("garra_ataque_cd", 40);
    source.dimension.playSound("random.bow", source.location, { volume: 0.3, pitch: 1.0 });

    source.playAnimation("animation.default_player_grapple_inicio", { controller: "camada_braco", blendOutTime: 0 });
    source.playAnimation("animation.default_player_grapple_inicio_corpo", { controller: "camada_corpo", blendOutTime: 0.1 });
    
    animationStates.set(playerId, { 
        phase: 'inicio', 
        startTick: currentTick 
    });

    const playerViewDir = source.getViewDirection();
    const playerHead = source.getHeadLocation();
    playerHead.y -= 0.4; 
    
    let projectileEntity = source.dimension.spawnEntity("parkour:garra_projectile", playerHead);
    const leashable = projectileEntity.getComponent("minecraft:leashable");
    if (leashable) leashable.leashTo(source);

    const MAX_GRAPPLE_RANGE = 45;

    // 1. Verificar Colisão com Bloco
    const blockView = source.getBlockFromViewDirection({ maxDistance: MAX_GRAPPLE_RANGE, includeLiquidBlocks: false, includePassableBlocks: false });
    let blockDistance = Infinity;
    let blockTargetPos = null;
    let exactBlockLoc = null;
    let hasHitBlock = false;

    if (blockView && blockView.block) {
        const blockLoc = blockView.block.location;
        const blockFaceLoc = blockView.faceLocation;
        exactBlockLoc = blockLoc; 

        let faceAdaptation = {
            'North': { x: 0, y: 0, z: -0.03 }, 'South': { x: 0, y: 0, z: 0.03 }, 'East': { x: 0.03, y: 0, z: 0 },
            'West': { x: -0.03, y: 0, z: 0 }, 'Up': { x: 0, y: 0.03, z: 0 }, 'Down': { x: 0, y: -0.03, z: 0 }
        }[blockView.face];

        blockTargetPos = vector.sum({ x: blockLoc.x + blockFaceLoc.x, y: blockLoc.y + blockFaceLoc.y, z: blockLoc.z + blockFaceLoc.z }, faceAdaptation);
        blockDistance = vector.distance(playerHead, blockTargetPos);
        hasHitBlock = true;
    }

    // 2. Verificar Colisão com Entidade (Mob)
    let targetMob = null;
    let mobHitDistance = Infinity;

    try {
        const entityHits = source.dimension.getEntitiesFromRay(playerHead, playerViewDir, {
            maxDistance: MAX_GRAPPLE_RANGE,
            ignoreBlockCollision: false,
            includeLiquidBlocks: false,
            includePassableBlocks: false
        });

        for (const hit of entityHits) {
            const entity = hit.entity;
            if (!checkEntityValid(entity) || entity.id === source.id) continue;
            if (UNHOOKABLE_ENTITY_TYPES.has(entity.typeId)) continue;
            
            const health = entity.getComponent(EntityComponentTypes.Health);
            if (!health) continue;

            targetMob = entity;
            mobHitDistance = hit.distance;
            break;
        }
    } catch (e) {}

    let isMobTarget = false;
    let targetPos;

    if (checkEntityValid(targetMob) && mobHitDistance <= blockDistance + 0.1) {
        isMobTarget = true;
        hasHitBlock = false;
        targetPos = targetMob.location;
    } else if (hasHitBlock) {
        targetPos = blockTargetPos;
    } else {
        targetPos = vector.sum(playerHead, vector.multiply(playerViewDir, MAX_GRAPPLE_RANGE));
    }

    const HOOK_VISUAL_SPEED = 2.0; 
    const HOOK_RETURN_SPEED = 2.5;

    grapplingHookData[playerId] = {
        entity: projectileEntity,
        phase: "FIRING",
        targetPos: targetPos,
        hasHitBlock: hasHitBlock,
        exactBlockLoc: exactBlockLoc,
        isMobTarget: isMobTarget,
        mobTarget: targetMob,
        hasLatchedToMob: false,
        mobAnchorOffset: null,
        
        tick: system.runInterval(() => {
            try {
                if (!checkEntityValid(source) || !checkEntityValid(projectileEntity)) {
                    return stopGrapplingEvent(playerId, projectileEntity, source);
                }

                const state = grapplingHookData[playerId];
                if (!state) return;

                const playerAttachment = { x: source.location.x, y: source.location.y + 1, z: source.location.z };

                handleGrappleAnimation(source, system.currentTick);

                if (state.phase === "FIRING") {
                    if (state.isMobTarget) {
                        if (checkEntityValid(state.mobTarget)) {
                            state.targetPos = state.mobTarget.location;
                        } else {
                            state.phase = "RETURNING";
                        }
                    }

                    if (state.phase === "FIRING") {
                        const nextPos = vector.moveTowards(projectileEntity.location, state.targetPos, HOOK_VISUAL_SPEED);
                        projectileEntity.teleport(nextPos, { rotation: {x: 0, y: 0}, checkForBlocks: false });

                        const distToTarget = vector.distance(nextPos, state.targetPos);

                        if (distToTarget <= 0.8 || distToTarget <= HOOK_VISUAL_SPEED * 0.5) {
                            if (state.isMobTarget) {
                                if (checkEntityValid(state.mobTarget)) {
                                    const target = state.mobTarget;
                                    source.dimension.playSound("random.click", projectileEntity.location, { volume: 1.0, pitch: 0.8 });

                                    if (DAMAGE_ONLY_ENTITY_TYPES.has(target.typeId)) {
                                        state.phase = "RETURNING";
                                    } else {
                                        state.phase = "MOB_PULL";
                                        state.hasLatchedToMob = true;
                                        state.mobAnchorOffset = vector.subtract(projectileEntity.location, target.location);

                                        try { source.startItemCooldown("garra_ataque_cd", COOLDOWN_TRAVADO_TICKS); } catch(e) {}

                                        const animState = animationStates.get(playerId);
                                        if (animState) animState.phase = 'puxar'; 
                                        
                                        source.playAnimation("animation.default_player_grapple_puxar", { controller: "camada_braco", blendOutTime: 0.3 });
                                        source.playAnimation("animation.default_player_grapple_inicio_corpo", { controller: "camada_corpo", blendOutTime: 0.1 });
                                    }
                                } else {
                                    state.phase = "RETURNING";
                                }
                            }
                            else if (state.hasHitBlock) {
                                source.dimension.playSound("random.click", state.targetPos, { volume: 1.0, pitch: 0.8 });
                                
                                const animState = animationStates.get(playerId);
                                if (animState) animState.phase = 'puxar'; 
                                
                                source.playAnimation("animation.default_player_grapple_puxar", { controller: "camada_braco", blendOutTime: 0.3 });
                                source.playAnimation("animation.default_player_grapple_inicio_corpo", { controller: "camada_corpo", blendOutTime: 0.1 });

                                const bLoc = state.exactBlockLoc;
                                const sLoc = source.location;
                                const o = { x: bLoc.x + 0.5 - sLoc.x, y: bLoc.y + 0.5 - sLoc.y, z: bLoc.z + 0.5 - sLoc.z };
                                const c = Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z);
                                
                                const horizontalMultiplier = 0.37;
                                const verticalMultiplier = 0.2;
                                const verticalForce = c > 10 ? Math.max(1, o.y * verticalMultiplier) : (o.y * verticalMultiplier);

                                try {
                                    source.applyKnockback(o.x, o.z, horizontalMultiplier * c, verticalForce);
                                    source.addTag("garra_fallproof");
                                    source.startItemCooldown("garra_mochila_cd", 200); 
                                } catch(e) {}

                                state.phase = "RETURNING";
                            } 
                            else {
                                state.phase = "RETURNING"; 
                            }
                        }
                    }
                }
                else if (state.phase === "MOB_PULL") {
                    const target = state.mobTarget;

                    if (!checkEntityValid(target)) {
                        state.phase = "RETURNING";
                        return;
                    }

                    try {
                        const hp = target.getComponent(EntityComponentTypes.Health);
                        if (!hp || hp.currentValue <= 0) {
                            state.phase = "RETURNING";
                            return;
                        }
                    } catch(e) {
                        state.phase = "RETURNING";
                        return;
                    }

                    const hookPos = vector.sum(target.location, state.mobAnchorOffset || { x: 0, y: 0.8, z: 0 });
                    projectileEntity.teleport(hookPos, { rotation: {x: 0, y: 0}, checkForBlocks: false });

                    let mobPoint = target.location;
                    try { mobPoint = target.getAABB().center; } catch(e) {}

                    const towardPlayerVec = vector.subtract(playerAttachment, mobPoint);
                    const currentDistance = vector.length(towardPlayerVec);

                    if (currentDistance < 0.001) {
                        state.phase = "RETURNING";
                        return;
                    }

                    const towardPlayerNorm = vector.normalize(towardPlayerVec);
                    const stopRadius = MOB_PULL_STOP_DISTANCE + MOB_PULL_STOP_BUFFER;

                    let vel = { x: 0, y: 0, z: 0 };
                    try { vel = target.getVelocity(); } catch(e) {}

                    const inwardSpeed = vector.dot(vel, towardPlayerNorm);

                    if (currentDistance <= stopRadius) {
                        if (inwardSpeed > 0) {
                            try {
                                target.applyImpulse(vector.multiply(towardPlayerNorm, -inwardSpeed));
                            } catch(e) {}
                        }
                        state.phase = "RETURNING";
                        return;
                    }

                    const maxSafeClosingSpeed = Math.max(0, currentDistance - stopRadius);
                    const desiredInwardSpeed = Math.min(MOB_PULL_TARGET_SPEED, maxSafeClosingSpeed);
                    let impulseMag = desiredInwardSpeed - inwardSpeed;

                    if (impulseMag > 0) {
                        impulseMag = Math.min(impulseMag, MOB_PULL_MAX_ACCEL_IMPULSE);
                        try {
                            target.applyImpulse(vector.multiply(towardPlayerNorm, impulseMag));
                        } catch(e) {
                            state.phase = "RETURNING";
                        }
                    }
                }
                else if (state.phase === "RETURNING") {
                    const distanceToPlayer = vector.distance(projectileEntity.location, playerAttachment);
                    
                    if (distanceToPlayer > HOOK_RETURN_SPEED && distanceToPlayer > 1.5) {
                        const nextPos = vector.moveTowards(projectileEntity.location, playerAttachment, HOOK_RETURN_SPEED);
                        projectileEntity.teleport(nextPos, { rotation: {x: 0, y: 0}, checkForBlocks: false });
                    } else {
                        source.dimension.playSound("random.pop", source.location, { volume: 0.3, pitch: 1.0 });
                        stopGrapplingEvent(playerId, projectileEntity, source);
                    }
                }
            } catch (err) {
                // Em caso de qualquer erro imprevisto durante o tick, finaliza o evento e recolhe a garra
                stopGrapplingEvent(playerId, projectileEntity, source);
            }
        }, 1)
    };
}

function stopGrapplingEvent(sourceId, entity, sourcePlayer) {
    const data = grapplingHookData[sourceId];
    const hasHitBlock = data ? data.hasHitBlock : false;
    const hasLatchedToMob = data ? data.hasLatchedToMob : false;
    
    if (checkEntityValid(entity)) {
        entity.remove();
    } else if (data?.entity && checkEntityValid(data.entity)) {
        data.entity.remove();
    }
    
    if (checkEntityValid(sourcePlayer)) {
        if (!hasHitBlock) {
            sourcePlayer.playAnimation("animation.default_player_grapple_inicio_loop_end", { controller: "camada_braco", blendOutTime: 0.2 });
        }
        
        if (hasLatchedToMob) {
            try { sourcePlayer.startItemCooldown("garra_ataque_cd", 0); } catch(e) {}
        }
    }
    
    animationStates.delete(sourceId);

    try {
        if (data?.tick) system.clearRun(data.tick);
        delete grapplingHookData[sourceId];
    } catch {}
}

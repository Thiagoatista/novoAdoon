import { world, system, EquipmentSlot } from "@minecraft/server";
import { BlockScanner } from "../utils/abilities_scanners.js";

const FOOT_OFFSET = 0.14;        
const PARTICLE_Y_OFFSET = 0.12;  

// Mapas para os passos em movimento (sincronizados)
const cicloDePassosZapMap = new Map();
const peEsquerdoZapMap = new Map();

// Mapas para os zaps aleatórios quando parado
const nextLeftZapMap = new Map();
const nextRightZapMap = new Map();

function getZapRandomTicks() {
    return Math.floor(Math.random() * 40) + 20;
}

world.afterEvents.playerLeave.subscribe((ev) => {
    cicloDePassosZapMap.delete(ev.playerId);
    peEsquerdoZapMap.delete(ev.playerId);
    nextLeftZapMap.delete(ev.playerId);
    nextRightZapMap.delete(ev.playerId);
});

// Função para partículas de passos (em movimento)
function spawnarZapDePe(player, loc, directionVector, multiplicadorLado) {
    const horizontalLen = Math.hypot(directionVector.x, directionVector.z);
    let rightX = 0;
    let rightZ = 0;

    if (horizontalLen > 0.001) {
        rightX = (-directionVector.z) / horizontalLen;
        rightZ = (directionVector.x) / horizontalLen;
    } else {
        rightX = 1;
        rightZ = 0;
    }

    const spawnX = loc.x + (rightX * FOOT_OFFSET * multiplicadorLado);
    const spawnZ = loc.z + (rightZ * FOOT_OFFSET * multiplicadorLado);

    const posicaoDoPe = {
        x: spawnX,
        y: loc.y + PARTICLE_Y_OFFSET,
        z: spawnZ
    };

    try {
        player.dimension.spawnParticle("parkour:zap_boots", posicaoDoPe);
    } catch (e) {}
}

// Função para os zaps aleatórios quando o jogador está PARADO
function handleIdleRandomZaps(player, tick) {
    const playerId = player.id;

    if (!nextLeftZapMap.has(playerId)) nextLeftZapMap.set(playerId, tick + getZapRandomTicks());
    if (!nextRightZapMap.has(playerId)) nextRightZapMap.set(playerId, tick + getZapRandomTicks());

    const doLeftZap = tick >= nextLeftZapMap.get(playerId);
    const doRightZap = tick >= nextRightZapMap.get(playerId);

    if (!doLeftZap && !doRightZap) return;

    const loc = player.location;
    const viewDir = player.getViewDirection();
    const horizontalLen = Math.hypot(viewDir.x, viewDir.z);
    let rightX = 1;
    let rightZ = 0;

    if (horizontalLen > 0.001) {
        rightX = (-viewDir.z) / horizontalLen;
        rightZ = (viewDir.x) / horizontalLen;
    }

    if (doLeftZap) {
        const spawnX = loc.x - (rightX * FOOT_OFFSET);
        const spawnZ = loc.z - (rightZ * FOOT_OFFSET);
        try { 
            player.dimension.spawnParticle("parkour:zap_boots", { x: spawnX, y: loc.y + PARTICLE_Y_OFFSET, z: spawnZ }); 
        } catch(e){}
        nextLeftZapMap.set(playerId, tick + getZapRandomTicks()); 
    }

    if (doRightZap) {
        const spawnX = loc.x + (rightX * FOOT_OFFSET);
        const spawnZ = loc.z + (rightZ * FOOT_OFFSET);
        try { 
            player.dimension.spawnParticle("parkour:zap_boots", { x: spawnX, y: loc.y + PARTICLE_Y_OFFSET, z: spawnZ }); 
        } catch(e){}
        nextRightZapMap.set(playerId, tick + getZapRandomTicks()); 
    }
}

system.runInterval(() => {
    const tick = system.currentTick;

    for (const player of world.getPlayers()) {
        if (!player.isValid) continue;

        const equip = player.getComponent("minecraft:equippable");
        if (!equip) continue;

        const feet = equip.getEquipment(EquipmentSlot.Feet);
        if (feet && feet.typeId === "parkour:gold_boot_velocity") {
            
            player.addEffect("speed", 40, { amplifier: 1, showParticles: false });

            const isTravado = player.hasTag("parkour_travado") || player.hasTag("parkour_wall_sliding");
            
            // TRAVA DE SHIFT E TRAVAMENTO: Se estiver agachado ou travado, cancela ambas as partículas
            if (isTravado || player.isSneaking) {
                cicloDePassosZapMap.delete(player.id);
                nextLeftZapMap.delete(player.id);
                nextRightZapMap.delete(player.id);
                continue;
            }

            // Checagem de água no pé via scanner
            const inWater = BlockScanner.scan(player, { needSpectralWaterCheck: true }).spectralWaterCheck;

            if (!player.isOnGround || inWater) {
                cicloDePassosZapMap.delete(player.id);
                nextLeftZapMap.delete(player.id);
                nextRightZapMap.delete(player.id);
                continue;
            } 
            
            const vel = player.getVelocity();
            const velocidadeHorizontal = Math.hypot(vel.x, vel.z);

            if (velocidadeHorizontal > 0.03) {
                // EM MOVIMENTO: Reseta timers de idle e roda os passos sincronizados alternados
                nextLeftZapMap.delete(player.id);
                nextRightZapMap.delete(player.id);

                let distanciaAcumulada = cicloDePassosZapMap.get(player.id) || 0;
                distanciaAcumulada += velocidadeHorizontal;

                const LIMITE_PASSO = 0.95;

                if (distanciaAcumulada >= LIMITE_PASSO) {
                    distanciaAcumulada %= LIMITE_PASSO;

                    const ePeEsquerdo = peEsquerdoZapMap.get(player.id) ?? true;
                    peEsquerdoZapMap.set(player.id, !ePeEsquerdo);

                    const multiplicadorLado = ePeEsquerdo ? -1 : 1;
                    const direcaoDoMovimento = { x: vel.x, y: 0, z: vel.z };

                    spawnarZapDePe(player, player.location, direcaoDoMovimento, multiplicadorLado);
                }

                cicloDePassosZapMap.set(player.id, distanciaAcumulada);
            } else {
                // PARADO: Reseta acumulador de passos e ativa zaps aleatórios de estática
                cicloDePassosZapMap.delete(player.id);
                handleIdleRandomZaps(player, tick);
            }
        } else {
            cicloDePassosZapMap.delete(player.id);
            peEsquerdoZapMap.delete(player.id);
            nextLeftZapMap.delete(player.id);
            nextRightZapMap.delete(player.id);
        }
    }
});


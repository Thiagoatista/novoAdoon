import { world, system, MolangVariableMap } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { BlockScanner } from "../utils/abilities_scanners.js";

const FOOT_OFFSET = 0.14;        
const PARTICLE_Y_OFFSET = 0.12;  
const cicloDePassosMap = new Map();
const peEsquerdoMap = new Map(); 

// Variáveis para rastrear impacto de queda e velocidade
const estavaNoAr = new Map();
const lastVelYMap = new Map(); // Guarda a velocidade Y do tick anterior ao impacto

// Somente superfícies nesta allowlist podem gerar pegadas.
const ALLOWED_FOOTSTEP_BLOCKS = new Set([
    "minecraft:grass_block",
    "minecraft:mycelium",
    "minecraft:soul_sand",
    "minecraft:crimson_nylium",
    "minecraft:coarse_dirt",
    "minecraft:dirt",
    "minecraft:dirt_with_roots",
    "minecraft:farmland",
    "minecraft:grass_path",
    "minecraft:podzol",
    "minecraft:mud",
    "minecraft:clay",
    "minecraft:sand",
    "minecraft:red_sand",
    "minecraft:suspicious_sand",
    "minecraft:gravel",
    "minecraft:suspicious_gravel",
    "minecraft:moss_block",
    "minecraft:pale_moss_block",
    "minecraft:warped_nylium",
    "minecraft:muddy_mangrove_roots",
    "minecraft:sculk",
    "minecraft:sponge",
    "minecraft:wet_sponge",
    "minecraft:snow",
    "minecraft:snow_layer",
    "minecraft:powder_snow",
    "minecraft:hay_block",
    "minecraft:slime",
    "minecraft:honey_block",
    "minecraft:moss_carpet",
    "minecraft:pale_moss_carpet"
]);

function isAllowedFootstepSurface(blockId) {
    return ALLOWED_FOOTSTEP_BLOCKS.has(blockId) ||
        /^minecraft:[a-z_]+_leaves(?:_flowered)?$/.test(blockId) ||
        /^minecraft:[a-z_]+_coral_block$/.test(blockId) ||
        /^minecraft:[a-z_]+_(carpet|wool|concrete_powder)$/.test(blockId);
}

world.afterEvents.playerLeave.subscribe((ev) => {
    cicloDePassosMap.delete(ev.playerId);
    peEsquerdoMap.delete(ev.playerId);
    estavaNoAr.delete(ev.playerId);
    lastVelYMap.delete(ev.playerId);
});

// Função auxiliar para spawnar a partícula
function spawnarParticulaDePe(player, loc, directionVector, multiplicadorLado, yaw, particulaID) {
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

    const molangVars = new MolangVariableMap();
    molangVars.setFloat("variable.footstep_rotation", yaw);

    try {
        player.dimension.spawnParticle(particulaID, posicaoDoPe, molangVars);
    } catch (e) {}
}

system.runInterval(() => {
    const currentTick = system.currentTick;
    const players = typeof world.getAllPlayers === 'function' ? world.getAllPlayers() : world.getPlayers();

    for (const player of players) {
        if (!player.isValid) continue;

        if (!SettingsManager.enabled(player.name, 'footstep')) {
            cicloDePassosMap.delete(player.id);
            peEsquerdoMap.delete(player.id);
            estavaNoAr.delete(player.id);
            lastVelYMap.delete(player.id);
            continue;
        }

        // VERIFICAÇÃO SE ESTÁ MONTADO/SENTADO EM UMA ENTIDADE (Barco, Cavalo, Carrinho, etc.)
        try {
            if (player.getComponent("minecraft:riding")) {
                cicloDePassosMap.delete(player.id);
                estavaNoAr.delete(player.id);
                lastVelYMap.delete(player.id);
                continue;
            }
        } catch (e) {}

        if (player.isSneaking) {
            cicloDePassosMap.delete(player.id);
            continue;
        }

        const vel = player.getVelocity();
        const isOnGround = player.isOnGround;
        const previouslyInAir = estavaNoAr.get(player.id) ?? false;
        const ultimaVelY = lastVelYMap.get(player.id) ?? 0;

        const velocidadeHorizontal = Math.hypot(vel.x, vel.z);
        const isLanding = isOnGround && previouslyInAir;
        const isWalking = isOnGround && velocidadeHorizontal > 0.03;
        if (!isLanding && !isWalking) {
            estavaNoAr.set(player.id, !isOnGround);
            lastVelYMap.set(player.id, isOnGround ? 0 : vel.y);
            cicloDePassosMap.delete(player.id);
            continue;
        }

        // Pega o bloco abaixo do jogador e verifica água via flags
        const scanResult = BlockScanner.scan(player, { 
            needBlockBelowCheck: true,
            needSpectralWaterCheck: true
        });
        
        const blocoAbaixo = scanResult.blockBelow;
        let blocoNoPe = null;

        try {
            blocoNoPe = player.dimension.getBlock({ 
                x: Math.floor(player.location.x), 
                y: Math.floor(player.location.y), 
                z: Math.floor(player.location.z) 
            });
        } catch(e) {}

        const hasBlockAtFeet = !!blocoNoPe && !blocoNoPe.isAir;
        const blockId = hasBlockAtFeet
            ? blocoNoPe.typeId
            : blocoAbaixo && !blocoAbaixo.isAir ? blocoAbaixo.typeId : "";
        
        let particulaParaUsar = "parkour_air:footstap";
        if (blockId === "minecraft:snow" || blockId === "minecraft:snow_layer" || blockId === "minecraft:powder_snow") {
            particulaParaUsar = "parkour_air:footstap_neve";
        }

        const deveAparecer = !scanResult.spectralWaterCheck && isAllowedFootstepSurface(blockId);

        // LÓGICA DE IMPACTO DE QUEDA (Pouso)
        if (isOnGround && previouslyInAir) {
            if (ultimaVelY < -0.3 && deveAparecer) {
                const moveYaw = player.getRotation().y;
                
                const horizSpeed = Math.hypot(vel.x, vel.z);
                const dirVector = horizSpeed > 0.05 ? { x: vel.x, y: 0, z: vel.z } : player.getViewDirection();

                spawnarParticulaDePe(player, player.location, dirVector, -1, -moveYaw, particulaParaUsar);
                spawnarParticulaDePe(player, player.location, dirVector, 1, -moveYaw, particulaParaUsar);
            }
        }

        estavaNoAr.set(player.id, !isOnGround);
        if (!isOnGround) {
            lastVelYMap.set(player.id, vel.y);
        } else {
            lastVelYMap.set(player.id, 0);
        }

        // LÓGICA NORMAL DE PASSOS DE CAMINHADA
        if (velocidadeHorizontal > 0.03 && isOnGround) {
            let distanciaAcumulada = cicloDePassosMap.get(player.id) || 0;
            distanciaAcumulada += velocidadeHorizontal;

            const LIMITE_PASSO = 0.95;

            if (distanciaAcumulada >= LIMITE_PASSO) {
                distanciaAcumulada %= LIMITE_PASSO;

                const ePeEsquerdo = peEsquerdoMap.get(player.id) ?? true;
                peEsquerdoMap.set(player.id, !ePeEsquerdo);

                if (deveAparecer) {
                    const moveYaw = -Math.atan2(vel.x, vel.z) * (180 / Math.PI);
                    const multiplicadorLado = ePeEsquerdo ? -1 : 1;
                    const direcaoDoMovimento = { x: vel.x, y: 0, z: vel.z };
                    
                    spawnarParticulaDePe(player, player.location, direcaoDoMovimento, multiplicadorLado, moveYaw, particulaParaUsar);
                }
            }

            cicloDePassosMap.set(player.id, distanciaAcumulada);
        } else {
            cicloDePassosMap.delete(player.id);
        }
    }
});

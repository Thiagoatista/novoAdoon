import { world, system } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
// Importação do scanner unificado
import { BlockScanner } from "../utils/abilities_scanners.js";

const tickAnteriorMap = new Map();

world.afterEvents.playerLeave.subscribe((event) => {
    tickAnteriorMap.delete(event.playerId);
});

world.afterEvents.playerSpawn.subscribe((ev) => {
    try { tickAnteriorMap.delete(ev.player.id); } catch(e){}
});

system.runInterval(() => {
    const currentTick = system.currentTick;
    const allPlayers = typeof world.getAllPlayers === 'function' ? world.getAllPlayers() : world.getPlayers();
    
    for (const player of allPlayers) {
        if (!player.isValid) continue;
        if (!SettingsManager.enabled(player.name, 'crawl')) {
            tickAnteriorMap.delete(player.id);
            continue;
        }
        
        processarRastejoNativo(player, currentTick);
    }
});

function processarRastejoNativo(player, currentTick) {
    if (tickAnteriorMap.get(player.id) === currentTick) return;
    tickAnteriorMap.set(player.id, currentTick);

    const vel = typeof player.getVelocity === 'function' ? player.getVelocity() : player.velocity;
    const velocidadeAlta = Math.hypot(vel.x, vel.z) > 0.2; 
    const sobEfeitoDoSlide = player.getEffect("resistance")?.amplifier === 255;
    
    if (!player.isOnGround || !player.isSneaking || player.isSprinting || estaNaAgua(player) || velocidadeAlta || sobEfeitoDoSlide) {
        return;
    }

    // Usando as flags do scanner unificado
    const scanResult = BlockScanner.scan(player, {
        needSlideMovement: true,
        needCrawlWall: true,
        needCrawlGap: true
    });

    const direcaoMovimento = scanResult.slideMovement;
    const seMovendo = direcaoMovimento.ativo;

    const cabecaY = player.getHeadLocation().y;
    const peY = player.location.y;
    const jaRastejandoNativo = Math.abs(peY - cabecaY) < 0.301;

    if (seMovendo && !jaRastejandoNativo) {
        
        // Verifica se tem parede (usa o retorno da flag)
        if (scanResult.crawlWall) return;
        
        // Verifica se tem buraco (usa o retorno da flag)
        if (!scanResult.crawlGap.temQueda) return;

        const loc = player.location;
        const novaPos = {
            x: loc.x + (direcaoMovimento.x * 0.05),
            y: loc.y + 0.12,
            z: loc.z + (direcaoMovimento.z * 0.05)
        };

        try {
            let teleporteSucedido = false;
            
            if (typeof player.tryTeleport === 'function') {
                if (player.tryTeleport(novaPos)) {
                    player.teleport(novaPos);
                    teleporteSucedido = true;
                }
            } else if (typeof player.teleport === 'function') {
                player.teleport(novaPos);
                teleporteSucedido = true;
            }
            
            if (teleporteSucedido) {
                player.dimension.playSound("step.stone", player.location, { pitch: 1.0, volume: 1.5 });
            }
        } catch(e) {}
    }
}

function estaNaAgua(player) {
    try {
        const blocoAtual = player.dimension.getBlock(player.location);
        return blocoAtual?.isLiquid || blocoAtual?.isWaterlogged || false;
    } catch(e) { return false; }
}

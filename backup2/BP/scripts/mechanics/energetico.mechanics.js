import { world, system } from "@minecraft/server";

// --- CONFIGURAÇÕES DO CAFÉ ---
const COFFEE_DURATION = 1800; // Tempo de duração em ticks (1800 = 90 segundos)
const SPEED_LEVEL = 1;        // Amplificador da velocidade (1 = Nível 2)
const HASTE_LEVEL = 1;        // Amplificador da mineração (1 = Nível 2)

world.afterEvents.itemCompleteUse.subscribe((ev) => {
    const item = ev.itemStack;
    const player = ev.source;

    if (item.typeId === "parkour:solucao_energetica") {
        
        // Aplica os efeitos
        player.addEffect("speed", COFFEE_DURATION, { amplifier: SPEED_LEVEL, showParticles: false });
        player.addEffect("haste", COFFEE_DURATION, { amplifier: HASTE_LEVEL, showParticles: false });

        player.dimension.playSound("block.brewing_stand.brew", player.location, { volume: 0.8, pitch: 1.0 }); 

        // --- CÁLCULO DA POSIÇÃO (MEIO DO CORPO) ---
        const middleLocation = { 
            x: player.location.x, 
            y: player.location.y + 1.0, 
            z: player.location.z 
        };

        // Nova partícula de café principal (AGORA EXECUTA SÓ UMA VEZ!)
        player.dimension.spawnParticle("parkour:splash_gota_coffe", middleLocation);
    }
});


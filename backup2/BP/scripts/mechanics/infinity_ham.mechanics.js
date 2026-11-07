import { world, system, ItemStack } from "@minecraft/server";

// --- CONFIGURAÇÕES DA MO MOO (RAINHA VACA) ---
// Chance de uma vaca nascer como a Rainha (0.01 = 0,01%)
const MO_MOO_CHANCE_PERCENT = 0.01; 
const MO_MOO_TAG = "vaca_rainha";

// --- COOLDOWN DO USO DA PICANHA ---
world.afterEvents.itemCompleteUse.subscribe((ev) => {
    const player = ev.source;

    if (ev.itemStack.typeId === "parkour:infinity_ham") {
        player.startItemCooldown("infinity_ham_cd", 300);
    }
});

// --- SORTEIO AO NASCER ---
world.afterEvents.entitySpawn.subscribe((ev) => {
    const entity = ev.entity;

    if (entity.typeId !== "minecraft:cow") return;

    system.run(() => {
        if (!entity.isValid) return;

        try {
            if (entity.getComponent("minecraft:is_baby")) return;

            const chance = MO_MOO_CHANCE_PERCENT / 100;
            if (Math.random() <= chance && entity.isValid) {
                entity.addTag(MO_MOO_TAG);
            }
        } catch (error) {
            console.warn(`[Parkour] Falha ao marcar vaca rainha: ${error}`);
        }
    });
});

// --- EFEITO VISUAL DA COROA (A CADA 3 SEGUNDOS) ---
// 60 ticks = 3 segundos (vi que você alterou aqui!)
system.runInterval(() => {
    // Procura nas três dimensões do jogo
    const dimensoes = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
    
    for (const dimName of dimensoes) {
        try {
            const dim = world.getDimension(dimName);
            // Pega apenas as vacas que ganharam a tag no sorteio
            const rainhas = dim.getEntities({ tags: [MO_MOO_TAG] });
            
            for (const rainha of rainhas) {
                const loc = rainha.location;
                // Posiciona a partícula acima da cabeça da vaca
                const crownLoc = { x: loc.x, y: loc.y + 2, z: loc.z }; 
                
                dim.spawnParticle("parkour:moo_mom_crown", crownLoc);
            }
        } catch(e) {} // Ignora se a dimensão não estiver carregada
    }
}, 60);

// --- DROP DA PICANHA AO MORRER ---
world.afterEvents.entityDie.subscribe((ev) => {
    const entity = ev.deadEntity;
    
    // Verifica se quem morreu é uma vaca E se ela tem a tag de rainha
    if (entity.typeId === "minecraft:cow" && entity.hasTag(MO_MOO_TAG)) {
        const loc = entity.location;
        const dim = entity.dimension;
        
        try {
            // Spawna o item fisicamente no mundo, exatamente onde a Mo Moo morreu
            const picanha = new ItemStack("parkour:infinity_ham", 1);
            dim.spawnItem(picanha, loc);
        } catch(e) {}
    }
});

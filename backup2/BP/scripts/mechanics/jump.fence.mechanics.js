import { world, system } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { registerAbilityUse, getKnockbackCompensation } from "../main.js";
// Importação do scanner unificado
import { BlockScanner } from "../utils/abilities_scanners.js";

const TAG_PULO = "vaulting";

system.runInterval(() => {
    const currentTick = system.currentTick;
    for (const player of world.getPlayers()) {
        if (!player.isValid) continue;
        if (!SettingsManager.enabled(player.name, 'jump_fence')) continue;

        try {
            if (player.hasTag(TAG_PULO)) continue;
            
            if (player.hasTag("parkour_dash_active")) continue;

            const velocity = player.getVelocity();
            if (velocity.y < 0.1) continue;

            // Solicita a verificação do Jump Fence via scanner centralizado
            const canJumpFence = BlockScanner.scan(player, { needJumpFence: true }).jumpFence;

            if (canJumpFence) {
                const viewDir = player.getViewDirection(); 
                const location = player.location;

                player.addTag(TAG_PULO);
                
                registerAbilityUse(player); 

                player.playAnimation("animation.player.jump_fence", {
                    blendOutTime: 0.2,
                    stopExpression: "query.is_on_ground"
                });

                const compensation = getKnockbackCompensation(player);
                
                player.applyKnockback(
                    { x: viewDir.x * 0.2 * compensation, z: viewDir.z * 0.2 * compensation },
                    0.4
                );
                
                player.dimension.playSound("step.wood", location, { volume: 1.0, pitch: 1.0 });

                system.runTimeout(() => {
                    if (player.isValid) {
                        player.removeTag(TAG_PULO);
                    }
                }, 10);
            }
        } catch (e) { }
    }
});

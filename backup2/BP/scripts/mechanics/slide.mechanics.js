import { world, system, EquipmentSlot } from "@minecraft/server";
import { SettingsManager } from "../utils/settings_manager.js";
import { registerAbilityUse, getKnockbackCompensation } from "../main.js"; 
// Importação do scanner unificado
import { BlockScanner } from "../utils/abilities_scanners.js";

const listaDeAtordoados = new Map();
const ultimoEscaneamentoMap = new Map();
const controleDePuloMap = new Map();
const perfilDoSlideMap = new Map();
const invulnerabilidadeSlideAte = new Map();

world.beforeEvents.entityHurt.subscribe((event) => {
    const hurtEntity = event.hurtEntity;
    if (hurtEntity.typeId !== "minecraft:player") return;

    const protectionEndTick = invulnerabilidadeSlideAte.get(hurtEntity.id);
    if (protectionEndTick === undefined) return;

    if (system.currentTick >= protectionEndTick) {
        invulnerabilidadeSlideAte.delete(hurtEntity.id);
        return;
    }

    event.cancel = true;
});

// Limpeza quando o jogador entra/renasce
world.afterEvents.playerSpawn.subscribe((ev) => {
    try { 
        const player = ev.player;
        const playerId = player.id;

        invulnerabilidadeSlideAte.delete(playerId);
        ultimoEscaneamentoMap.delete(playerId);
        controleDePuloMap.delete(playerId);
        perfilDoSlideMap.delete(playerId);
    } catch(e){}
});

world.afterEvents.playerLeave.subscribe((ev) => {
    try {
        const playerId = ev.playerId;
        invulnerabilidadeSlideAte.delete(playerId);
        ultimoEscaneamentoMap.delete(playerId);
        controleDePuloMap.delete(playerId);
        perfilDoSlideMap.delete(playerId);
    } catch(e){}
});

const PITCH_VARIATIONS = [0.8, 0.9, 1.0, 1.1, 1.2]; 

// ============================================
// FUNÇÃO RESTAURADA USANDO AS FLAGS DO SCANNER
// ============================================
function realizarLeituraDeAmbiente(player, parametros) {
    const pacoteDeDados = {};
    
    // Dispara o scanner central com as flags necessárias
    const scanResult = BlockScanner.scan(player, {
        needSlideMovement: true, 
        needSlideGround: true,   
        needSlideWall: parametros.requerObstaculo,
        needSlideGap: parametros.requerFenda
    });
    
    if (parametros.requerMovimento) {
        pacoteDeDados.movimento = scanResult.slideMovement;
    }
    
    if (parametros.requerObstaculo) {
        pacoteDeDados.temParede = scanResult.slideWall;
    }
    
    if (parametros.requerFenda) {
        pacoteDeDados.fenda = scanResult.slideGap;
    }
    
    if (parametros.requerLiquido) {
        const blocoAtual = player.dimension.getBlock(player.location);
        pacoteDeDados.estaNaAgua = blocoAtual?.isLiquid || blocoAtual?.isWaterlogged || false;
    }
    
    return pacoteDeDados;
}

function obterPerfilDoSlide(playerId) {
    if (!perfilDoSlideMap.has(playerId)) {
        perfilDoSlideMap.set(playerId, { emAcao: false, instanteParada: null, fisica: null, estavaCorrendo: false });
    }
    return perfilDoSlideMap.get(playerId);
}

function processarMemoriaDeCorrida(player, currentTick, perfil) {
    if (player.isSprinting) {
        perfil.estavaCorrendo = true;
    } else {
        if (perfil.estavaCorrendo) {
            perfil.instanteParada = currentTick;
            perfil.estavaCorrendo = false;
        }
    }
}

function avaliarNecessidadeDePulo(leituraPassada, leituraPresente) {
    if (!leituraPassada || !leituraPresente) return false;
    const fendaAntiga = leituraPassada.fenda;
    const fendaNova = leituraPresente.fenda;
    return fendaNova && fendaNova.temQueda && fendaAntiga && !fendaAntiga.temQueda;
}

function finalizarMovimentoDeSlide(player, currentTick) {
    const perfil = obterPerfilDoSlide(player.id);
    if (!perfil) return;
    
    perfil.emAcao = false;
    perfil.fisica = null;
    
    if (player && player.isValid) {
        player.playAnimation("animation.slide.end", { blendOutTime: 0.2 });
    }

    ultimoEscaneamentoMap.delete(player.id);
    controleDePuloMap.delete(player.id);
}

function executarGolpeDeTrator(player) {
    try {
        const criaturasNoCaminho = player.dimension.getEntities({ location: player.location, maxDistance: 2.2 });
        
        const anguloVisao = player.getRotation().y;
        const radianos = (anguloVisao + 90) * (Math.PI / 180);
        const dirX = Math.cos(radianos);
        const dirZ = Math.sin(radianos);

        for (const alvo of criaturasNoCaminho) {
            if (alvo.id === player.id) continue;
            
            if (listaDeAtordoados.has(alvo.id)) continue;
            
            const identificador = alvo.typeId;
            if (identificador !== "minecraft:item" && identificador !== "minecraft:xp_orb") {
                const forcaX = alvo.location.x - player.location.x;
                const forcaZ = alvo.location.z - player.location.z;
                const distancia = Math.hypot(forcaX, forcaZ);
                
                if (distancia > 0.05) {
                    const estaNaFrente = (forcaX * dirX) + (forcaZ * dirZ);
                    const distanciaLateral = Math.abs((dirX * forcaZ) - (dirZ * forcaX));

                    if (estaNaFrente > 0 && distanciaLateral < 0.8) {
                        const isPlayer = alvo.typeId === "minecraft:player";
                        const attackerSlideSettings = SettingsManager.getStatus(player.name).slide;
                        const targetSlideSettings = isPlayer
                            ? SettingsManager.getStatus(alvo.name).slide
                            : undefined;
                        const stunEnabled = isPlayer
                            ? (
                                attackerSlideSettings.canStunPlayers
                                && targetSlideSettings.canReceiveStun
                            )
                            : attackerSlideSettings.canStunEntities;
                        const pushEnabled = isPlayer
                            ? (
                                attackerSlideSettings.canPushPlayers
                                && targetSlideSettings.canReceivePush
                            )
                            : attackerSlideSettings.canPushEntities;
                        const stunSeconds = isPlayer
                            ? Math.min(
                                attackerSlideSettings.stunPlayersSeconds,
                                targetSlideSettings.receiveStunSeconds
                            )
                            : attackerSlideSettings.stunEntitiesSeconds;
                        const pushIntensity = isPlayer
                            ? Math.min(
                                attackerSlideSettings.pushPlayersIntensity,
                                targetSlideSettings.receivePushIntensity
                            )
                            : attackerSlideSettings.pushEntitiesIntensity;

                        if (!pushEnabled && !stunEnabled) continue;

                        if (pushEnabled) {
                            alvo.applyKnockback(
                                {
                                    x: (forcaX / distancia) * pushIntensity,
                                    z: (forcaZ / distancia) * pushIntensity
                                },
                                pushIntensity / 3
                            );
                        }
                        if (stunEnabled) {
                            alvo.addEffect("slowness", Math.round(stunSeconds * 20), {
                                amplifier: 255,
                                showParticles: false
                            });
                        }
                        
                        listaDeAtordoados.set(alvo.id, { 
                            entidade: alvo, 
                            tickDeCura: system.currentTick + (
                                stunEnabled ? Math.round(stunSeconds * 20) : 40
                            ),
                            tickDoGolpe: system.currentTick,
                            particulasNasceram: false,
                            stunAplicado: stunEnabled
                        });
                        
                        const pontoDeContato = {
                            x: alvo.location.x,
                            y: alvo.location.y + 1.0, 
                            z: alvo.location.z
                        };
                        
                        player.dimension.spawnParticle("parkour:particle_punch_slide_variables", pontoDeContato);
                        
                        const pitchSorteado = PITCH_VARIATIONS[Math.floor(Math.random() * PITCH_VARIATIONS.length)];
                        player.dimension.playSound("game.player.attack.strong", pontoDeContato, { volume: 0.5, pitch: pitchSorteado });
                    }
                }
            }
        }
    } catch(err) {}
}

function orquestrarSlideAtivo(player, currentTick, perfil) {
    const pacoteFisico = perfil.fisica;
    if (!pacoteFisico) return;

    try {
        const equip = player.getComponent("minecraft:equippable");
        if (equip) {
            const mainhand = equip.getEquipmentSlot(EquipmentSlot.Mainhand);
            if (mainhand && mainhand.typeId === "parkour:garra_suspeita") {
                player.startItemCooldown("garra_slide_cd", 2);
            }
        }
    } catch(e) {}

    const ambiente = realizarLeituraDeAmbiente(player, { requerObstaculo: true, requerFenda: true, requerMovimento: true, requerLiquido: true });
    
    if (ambiente.estaNaAgua || currentTick - pacoteFisico.tickInicial > 14 || !player.isSneaking || ambiente.temParede) {
        finalizarMovimentoDeSlide(player, currentTick);
        return;
    }

    executarGolpeDeTrator(player);

    const diferencaDeTempo = (currentTick - pacoteFisico.ultimoTickDeAtualizacao) / 20;
    pacoteFisico.forcaDeImpulso *= Math.pow(0.35, diferencaDeTempo);
    pacoteFisico.ultimoTickDeAtualizacao = currentTick;

    const anguloVisao = player.getRotation().y;
    const radianosAjustados = (anguloVisao + 90) * Math.PI / 180;

    let verificacaoDoPe = null;
    try {
        verificacaoDoPe = player.dimension.getBlockFromRay(
            { x: player.location.x, y: player.location.y, z: player.location.z },
            { x: Math.cos(radianosAjustados), y: -1, z: Math.sin(radianosAjustados) },
            { maxDistance: 1, includePassableBlocks: false, includeLiquidBlocks: false }
        );
    } catch(e) {}

    const marcaDeTempoPulo = controleDePuloMap.get(player.id);
    const estaNaJanelaDePulo = marcaDeTempoPulo && currentTick - marcaDeTempoPulo < 3;
    
    let elevacao;
    const temChaoProximo = verificacaoDoPe && verificacaoDoPe.block && !verificacaoDoPe.block.isAir;
    
    if (ambiente.fenda && ambiente.fenda.temQueda && temChaoProximo) {
        elevacao = 0;
    } else if (estaNaJanelaDePulo) {
        elevacao = 0.04;
    } else if (player.isOnGround) {
        elevacao = 0.04;
        controleDePuloMap.set(player.id, currentTick);
    } else {
        elevacao = -0.14;
    }
    
    const compensation = getKnockbackCompensation(player);

    try {
        player.applyKnockback(
            {
                x: Math.cos(radianosAjustados) * pacoteFisico.forcaDeImpulso * compensation,
                z: Math.sin(radianosAjustados) * pacoteFisico.forcaDeImpulso * compensation
            },
            elevacao * compensation
        );
    } catch(e){}

    if (currentTick % 2 === 0) {
        try { 
            player.dimension.spawnParticle("parkour:smoke_slide", player.location);
            player.dimension.spawnParticle("parkour:debris_slide", player.location);
        } catch(e){}
    }

    const escaneamentoAntigo = ultimoEscaneamentoMap.get(player.id);
    
    if (avaliarNecessidadeDePulo(escaneamentoAntigo, ambiente) && ambiente.movimento && ambiente.movimento.ativo) {
        const novaPosicaoSegura = {
            x: player.location.x + ambiente.movimento.x * 0.05,
            y: player.location.y + 0.12,
            z: player.location.z + ambiente.movimento.z * 0.05
        };
        try {
            if (typeof player.tryTeleport === 'function') {
                if (player.tryTeleport(novaPosicaoSegura)) player.teleport(novaPosicaoSegura);
            } else if (typeof player.teleport === 'function') {
                player.teleport(novaPosicaoSegura);
            }
        } catch(e) {}
    }
    ultimoEscaneamentoMap.set(player.id, ambiente);
}

function processarRequisicaoDeSlide(player, currentTick) {
    if (!SettingsManager.enabled(player.name, 'slide')) return;

    const perfil = obterPerfilDoSlide(player.id);
    
    processarMemoriaDeCorrida(player, currentTick, perfil);

    const atendeAosRequisitos = player.isSprinting || (perfil.instanteParada && (currentTick - perfil.instanteParada <= 3));
    const podeIniciar = atendeAosRequisitos && player.isOnGround;

    if (podeIniciar && player.isSneaking && !perfil.emAcao) {
        const ambienteIncial = realizarLeituraDeAmbiente(player, { requerObstaculo: true, requerFenda: true, requerLiquido: true });
        if (ambienteIncial.estaNaAgua || ambienteIncial.temParede || (ambienteIncial.fenda && ambienteIncial.fenda.temQueda)) return;
        
        perfil.emAcao = true;
        
        player.playAnimation("animation.slide.start", { blendOutTime: 0.2 });
        player.dimension.playSound("game.player.attack.strong", player.location, { pitch: 0.8, volume: 0.5 });
        
        const immunityTicks = Math.round(
            SettingsManager.getStatus(player.name).slide.invulnerabilitySeconds * 20
        );
        const protectionEndTick = currentTick + immunityTicks;
        invulnerabilidadeSlideAte.set(player.id, protectionEndTick);
        system.runTimeout(() => {
            if (invulnerabilidadeSlideAte.get(player.id) === protectionEndTick) {
                invulnerabilidadeSlideAte.delete(player.id);
            }
        }, immunityTicks);

        registerAbilityUse(player);

        const orientacaoY = player.getRotation().y;
        perfil.fisica = {
            tickInicial: currentTick, 
            limiteDeDuracao: 14, 
            forcaDeImpulso: 0.85,
            ultimoTickDeAtualizacao: currentTick, 
            direcaoTravada: orientacaoY 
        };
    }

    if (perfil.emAcao) {
        orquestrarSlideAtivo(player, currentTick, perfil);
    }
}

system.runInterval(() => {
    const currentTick = system.currentTick;
    const allPlayers = typeof world.getAllPlayers === 'function' ? world.getAllPlayers() : world.getPlayers();
    
    for (const player of allPlayers) {
        if (player.isValid) {
            processarRequisicaoDeSlide(player, currentTick);
        }
    }

    // Gerenciador de Atordoamento e Partículas Finais
    for (const [alvoId, registroDeAtordoamento] of listaDeAtordoados.entries()) {
        const entidade = registroDeAtordoamento.entidade;
        
        if (!entidade.isValid) {
            listaDeAtordoados.delete(alvoId);
            continue;
        }

        if (registroDeAtordoamento.stunAplicado
            && !registroDeAtordoamento.particulasNasceram
            && currentTick > registroDeAtordoamento.tickDoGolpe + 5) {
            if (entidade.isOnGround) {
                try {
                    const cabecaDaVitima = { 
                        x: entidade.location.x, 
                        y: entidade.location.y + 2.0, 
                        z: entidade.location.z 
                    };
                    entidade.dimension.spawnParticle("parkour:pintinho_slide_stum_1", cabecaDaVitima);
                    entidade.dimension.spawnParticle("parkour:pintinho_slide_stum_2", cabecaDaVitima);
                    entidade.dimension.spawnParticle("parkour:pintinho_slide_stum_3", cabecaDaVitima);
                    
                    registroDeAtordoamento.particulasNasceram = true;
                } catch(err) {}
            }
        }

        if (currentTick >= registroDeAtordoamento.tickDeCura) {
            if (registroDeAtordoamento.stunAplicado) {
                try {
                    const meioDaVitima = { 
                        x: entidade.location.x, 
                        y: entidade.location.y + 1.0, 
                        z: entidade.location.z 
                    };
                    entidade.dimension.spawnParticle("parkour:pintinho_slide_stum_explosion", meioDaVitima);
                } catch(err) {}
            }

            listaDeAtordoados.delete(alvoId);
            continue;
        }
    }
});

/**
 * Rolagens automáticas de "fim de efeito" no início do turno.
 *
 * Efeitos aplicados a um personagem (system.appliedEffects) podem ter uma
 * rolagem para encerrar (endRoll). Este helper executa essas rolagens
 * automaticamente no início do turno do personagem — sem o jogador precisar
 * clicar no botão 🎲. Em caso de sucesso (≥ CD), o efeito é removido (e a
 * condição associada, se houver).
 *
 * O processamento roda em um único cliente (o GM responsável) para evitar
 * rolagens/remoções duplicadas em mesa com vários jogadores.
 */

import { rollLigeia, resolveAttr, rerollFor, critFor } from "./dice.mjs";

/** Detecta se ESTE cliente deve processar (apenas um GM ativo). */
function isResponsibleClient() {
  const activeGMs = game.users.filter((u) => u.isGM && u.active);
  if (!activeGMs.length) return game.user.isGM;
  const responsible = activeGMs.sort((a, b) => a.id.localeCompare(b.id))[0];
  return responsible?.id === game.user.id;
}

/**
 * Executa a rolagem de fim de UM efeito aplicado, postando o resultado.
 * @returns {boolean} true se o efeito encerrou (sucesso).
 */
async function rollEndForEffect(actor, ae) {
  const attrKey = ae.endRoll?.attr || "mente";
  const r = resolveAttr(actor, attrKey);
  const rm = actor.system?.rollMods || {};
  const rr = rerollFor(actor, attrKey);
  const cr = critFor(actor, attrKey);
  const dc = ae.endRoll?.dc || 0;
  const result = await rollLigeia({
    attribute: r.value,
    improvement: r.dice + (rm.all?.dice || 0),
    bonus: rm.all?.bonus || 0,
    difficulty: dc,
    reroll1: rr.reroll1,
    reroll6: rr.reroll6,
    critBonus: cr.critBonus,
    failBonus: cr.failBonus,
  });
  const success = result.total >= dc;
  const label = (CONFIG.LIGEIA?.attackAttrs?.[attrKey]) || attrKey;
  const note = success
    ? `<span class="lig-outcome ok">Encerrou!</span>`
    : `<span class="lig-outcome ko">Persiste</span>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong> — encerrar <em>${ae.label}</em> (início do turno · ${label} vs CD ${dc}): ${result.total} ${note}</div>`,
    rolls: [result.roll],
    sound: CONFIG.sounds.dice,
  });
  return success;
}

/**
 * Processa TODAS as rolagens de fim de efeito de um ator (as que estão
 * habilitadas e não desativadas). Remove os efeitos que encerrarem, junto das
 * condições associadas. Faz uma única atualização ao final.
 */
export async function processEndRollsAtTurnStart(actor) {
  if (!actor) return;
  const arr = foundry.utils.deepClone(actor.system?.appliedEffects || []);
  if (!arr.length) return;

  // Índices a remover (efeitos que encerraram).
  const toRemove = [];
  for (let i = 0; i < arr.length; i++) {
    const ae = arr[i];
    if (!ae?.endRoll?.enabled) continue;
    if (ae.disabled) continue; // efeito desligado não rola
    const ended = await rollEndForEffect(actor, ae);
    if (ended) toRemove.push(i);
  }
  if (!toRemove.length) return;

  // Monta o novo array sem os encerrados e limpa condições associadas.
  const removeSet = new Set(toRemove);
  const conditionsToClear = new Set(
    toRemove.map((i) => arr[i].conditionId).filter(Boolean)
  );
  const newArr = arr.filter((_, i) => !removeSet.has(i));
  const upd = { "system.appliedEffects": newArr };
  if (conditionsToClear.size) {
    upd["system.conditions"] = (actor.system?.conditions || []).filter(
      (c) => !conditionsToClear.has(c)
    );
  }
  await actor.update(upd);
}

/**
 * Rola o fim de UM efeito aplicado (por índice) e, em caso de sucesso, remove
 * o efeito e a condição associada. Usada tanto pelo botão manual da ficha
 * quanto (indiretamente) pelo processamento automático de turno.
 */
export async function rollSingleEndEffect(actor, idx) {
  const arr = foundry.utils.deepClone(actor.system?.appliedEffects || []);
  const ae = arr[idx];
  if (!ae || !ae.endRoll?.enabled) return false;
  const ended = await rollEndForEffect(actor, ae);
  if (!ended) return false;
  arr.splice(idx, 1);
  const upd = { "system.appliedEffects": arr };
  if (ae.conditionId) {
    upd["system.conditions"] = (actor.system?.conditions || []).filter((c) => c !== ae.conditionId);
  }
  await actor.update(upd);
  return true;
}

/** Registra o hook de início de turno para as rolagens de fim de efeito. */
export function registerTurnEffectHooks() {
  Hooks.on("updateCombat", async (combat, changed, options, userId) => {
    if (!isResponsibleClient()) return;
    // Só quando o turno (ou a rodada, que muda o combatente) avança.
    const turnChanged =
      Object.prototype.hasOwnProperty.call(changed, "turn") ||
      Object.prototype.hasOwnProperty.call(changed, "round");
    if (!turnChanged) return;
    const actor = combat.combatant?.actor;
    if (!actor) return;
    await processEndRollsAtTurnStart(actor);
  });
}

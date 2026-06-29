/**
 * Emanação: áreas/auras PERSISTENTES que ficam no canvas por uma duração e
 * disparam a rolagem/efeito de uma ação para todo token que INICIAR o turno
 * dentro delas.
 *
 * - Uma "área" é fixa num ponto; uma "aura" segue o token de origem.
 * - Os metadados ficam na flag `ligeia-rpg.emanation` do MeasuredTemplate.
 * - O disparo acontece no início do turno de cada combatente (hook de
 *   atualização do combate). A duração é controlada por rodadas (ou até o
 *   fim da cena) e os templates expirados são removidos.
 *
 * Tudo é processado apenas pelo GM (um único cliente), para evitar execuções
 * duplicadas em mesa com vários jogadores.
 */

import { rollItemAction } from "./dice.mjs";

const FLAG_SCOPE = "ligeia-rpg";
const FLAG_KEY = "emanation";

/** Lê a flag de emanação de um template (ou null). */
function emanationOf(template) {
  return template?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] || null;
}

/** Todos os templates de emanação da cena ativa. */
function emanationTemplates(scene) {
  const sc = scene || canvas?.scene;
  if (!sc) return [];
  return sc.templates.filter((t) => !!emanationOf(t));
}

/** Converte raio (unidades do grid) para pixels. */
function radiusToPx(radiusUnits) {
  const grid = canvas.grid;
  return (radiusUnits / grid.distance) * grid.size;
}

/** Um ponto (px) está dentro do círculo do template? */
function isPointInTemplate(px, py, template) {
  const r = radiusToPx(template.distance || 0);
  return Math.hypot(px - template.x, py - template.y) <= r + 0.5;
}

/**
 * Resolve a ação associada a uma emanação a partir das flags.
 * @returns {{actor, item, action}|null}
 */
async function resolveEmanationAction(ema) {
  let item = null;
  let action = null;
  let actor = null;
  try {
    if (ema.itemUuid) item = await fromUuid(ema.itemUuid);
    if (ema.actorUuid) actor = await fromUuid(ema.actorUuid);
  } catch (e) {
    item = null;
  }
  if (item) {
    const list = item.system?.actions || [];
    // Tenta pelo índice; se não bater, procura pelo label.
    action = list[ema.actionIndex] || list.find((a) => a.label === ema.actionLabel) || null;
    if (!actor) actor = item.parent || null;
  }
  if (!actor || !action) return null;
  return { actor, item, action };
}

/**
 * Dispara a rolagem/efeito de uma emanação contra UM ator-alvo (o que iniciou
 * o turno dentro da área). Reaproveita rollItemAction com override de alvo.
 */
async function triggerEmanationOn(ema, targetActor) {
  const resolved = await resolveEmanationAction(ema);
  if (!resolved) return;
  const { actor, item, action } = resolved;

  // Não reaplica os custos/macro da fonte a cada turno: clona a ação sem
  // custos e sem macro (a emanação é o efeito recorrente, não um novo conjuro).
  const turnAction = foundry.utils.deepClone(action);
  turnAction.costMp = 0; turnAction.costHp = 0; turnAction.costHeroic = 0;
  turnAction.macroUuid = ""; turnAction.macroEnabled = false;
  // A área já existe; ao disparar por turno NÃO recriamos template.
  turnAction.targetMode = "target";
  turnAction.persistArea = false;

  await rollItemAction({
    actor,
    item,
    action: turnAction,
    overrideTargets: [targetActor],
    hidden: actor.system?.rollHidden ?? false,
  });
}

/**
 * No início do turno de um combatente, verifica todas as emanações da cena e
 * dispara as que o contêm.
 */
async function handleTurnStart(combatant) {
  if (!combatant) return;
  const token = combatant.token?.object || canvas.tokens?.get(combatant.tokenId);
  const tokenDoc = combatant.token;
  const targetActor = combatant.actor;
  if (!targetActor || !tokenDoc) return;

  const cx = (tokenDoc.x ?? 0) + ((tokenDoc.width ?? 1) * canvas.grid.size) / 2;
  const cy = (tokenDoc.y ?? 0) + ((tokenDoc.height ?? 1) * canvas.grid.size) / 2;

  for (const template of emanationTemplates(combatant.parent?.scene)) {
    const ema = emanationOf(template);
    if (!ema) continue;
    // A fonte só é afetada se a ação marcar persistAffectsSelf.
    if (!ema.affectsSelf && ema.actorUuid === targetActor.uuid) continue;
    if (!isPointInTemplate(cx, cy, template)) continue;
    await triggerEmanationOn(ema, targetActor);
  }
}

/**
 * Decrementa a duração das emanações ao virar a rodada e remove as expiradas.
 * Emanações com rounds=0 duram até o fim da cena (não expiram por rodada).
 */
async function handleRoundAdvance(combat) {
  const scene = combat?.scene || canvas?.scene;
  if (!scene) return;
  const toDelete = [];
  const updates = [];
  for (const template of emanationTemplates(scene)) {
    const ema = emanationOf(template);
    if (!ema || !ema.rounds) continue; // 0 = até fim da cena
    const remaining = (ema.remaining ?? ema.rounds) - 1;
    if (remaining <= 0) {
      toDelete.push(template.id);
    } else {
      updates.push({ _id: template.id, [`flags.${FLAG_SCOPE}.${FLAG_KEY}.remaining`]: remaining });
    }
  }
  if (updates.length) await scene.updateEmbeddedDocuments("MeasuredTemplate", updates);
  if (toDelete.length) {
    await scene.deleteEmbeddedDocuments("MeasuredTemplate", toDelete);
    ui.notifications?.info(`${toDelete.length} emanação(ões) expiraram.`);
  }
}

/**
 * Move as auras (emanações que seguem o token) quando o token de origem se
 * move. Áreas fixas não se movem.
 */
async function handleTokenMove(tokenDoc) {
  const scene = tokenDoc.parent;
  if (!scene) return;
  const updates = [];
  for (const template of emanationTemplates(scene)) {
    const ema = emanationOf(template);
    if (!ema?.isAura) continue;
    if (ema.sourceTokenId !== tokenDoc.id) continue;
    const cx = (tokenDoc.x ?? 0) + ((tokenDoc.width ?? 1) * canvas.grid.size) / 2;
    const cy = (tokenDoc.y ?? 0) + ((tokenDoc.height ?? 1) * canvas.grid.size) / 2;
    updates.push({ _id: template.id, x: cx, y: cy });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("MeasuredTemplate", updates);
}

/* ------------------------------------------------------------------ */
/*  Registro dos hooks                                                 */
/* ------------------------------------------------------------------ */

/** Detecta se ESTE cliente deve processar (apenas um GM ativo). */
function isResponsibleClient() {
  // O GM com menor id entre os ativos processa (evita duplicação).
  const activeGMs = game.users.filter((u) => u.isGM && u.active);
  if (!activeGMs.length) return game.user.isGM; // fallback
  const responsible = activeGMs.sort((a, b) => a.id.localeCompare(b.id))[0];
  return responsible?.id === game.user.id;
}

export function registerEmanationHooks() {
  // Início de turno: o Foundry dispara updateCombat com mudança de turn/round.
  Hooks.on("updateCombat", async (combat, changed, options, userId) => {
    if (!isResponsibleClient()) return;
    // Avanço de rodada (para expiração de duração).
    if (Object.prototype.hasOwnProperty.call(changed, "round")) {
      await handleRoundAdvance(combat);
    }
    // Mudança de turno (ou de rodada, que também muda o combatente ativo):
    const turnChanged =
      Object.prototype.hasOwnProperty.call(changed, "turn") ||
      Object.prototype.hasOwnProperty.call(changed, "round");
    if (turnChanged) {
      const current = combat.combatant;
      await handleTurnStart(current);
    }
  });

  // Aura segue o token de origem.
  Hooks.on("updateToken", async (tokenDoc, changed, options, userId) => {
    if (!isResponsibleClient()) return;
    if (!("x" in changed) && !("y" in changed)) return;
    await handleTokenMove(tokenDoc);
  });

  // Limpeza: ao encerrar o combate, remove as emanações de duração por rodada.
  Hooks.on("deleteCombat", async (combat) => {
    if (!isResponsibleClient()) return;
    const scene = combat?.scene || canvas?.scene;
    if (!scene) return;
    const ids = emanationTemplates(scene)
      .filter((t) => (emanationOf(t)?.rounds || 0) > 0)
      .map((t) => t.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("MeasuredTemplate", ids);
  });
}

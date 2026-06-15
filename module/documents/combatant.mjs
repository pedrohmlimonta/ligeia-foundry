/**
 * Combatant do Ligeia.
 *
 * Faz o carrossel de iniciativa usar a MESMA mecânica de rolagem da ficha
 * (2d6 + dados de melhoria com kh2/kl2 + bônus de efeitos), delegando ao
 * método getInitiativeRoll do ator. Sem isto, o combate usaria a fórmula
 * estática de CONFIG.Combat.initiative, que ignora os dados de melhoria e os
 * efeitos aplicados.
 */
export class LigeiaCombatant extends Combatant {
  /** @override */
  getInitiativeRoll(formula) {
    if (this.actor?.getInitiativeRoll) {
      return this.actor.getInitiativeRoll(formula);
    }
    return super.getInitiativeRoll(formula);
  }
}

/**
 * Classe base de Actor do Ligeia.
 * A maior parte da lógica derivada vive nos DataModels (prepareDerivedData).
 */
export class LigeiaActor extends Actor {
  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    // Os DataModels já calculam secundários/recursos via prepareDerivedData.
  }

  /**
   * Monta a rolagem de Iniciativa do combate usando a MESMA mecânica das
   * rolagens da ficha: 2d6 + dados de melhoria, mantendo os 2 maiores
   * (kh2); com desvantagem (dados negativos) mantém os 2 menores (kl2).
   * Soma o valor de Iniciativa + modificadores de efeitos de categoria "all".
   *
   * Isto sobrescreve a fórmula estática de CONFIG.Combat.initiative para que
   * o carrossel de iniciativa reflita os efeitos (dados e bônus) que também
   * aparecem na ficha.
   * @override
   */
  getInitiativeRoll(formula) {
    const sys = this.system || {};
    const sec = sys.secondary || {};
    const value = sec.iniciativa || 0;
    // Dados de melhoria da iniciativa (já incluem efeitos via prepareDerivedData)
    let dice = sec.iniciativaDice || 0;
    // Modificadores de categoria "all" (efeitos que afetam todas as rolagens)
    const rm = sys.rollMods || {};
    dice += rm.all?.dice || 0;
    const bonus = value + (rm.all?.bonus || 0);

    const extra = Math.abs(dice);
    const totalDice = 2 + extra;
    const keep = dice < 0 ? "kl2" : "kh2";
    const parts = [`${totalDice}d6${keep}`];
    if (bonus !== 0) parts.push(`${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}`);
    return new Roll(parts.join(" "), this.getRollData());
  }
}

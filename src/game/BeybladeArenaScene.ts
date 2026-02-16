import Phaser from "phaser";
import { aiActionDelay, aiMayReactivelyDodge, decideAiAction } from "@/lib/game/ai";
import { BEYBLADES } from "@/lib/game/beyblades";
import {
  emitArenaLog,
  emitArenaState,
  emitTauntRequest,
  getArenaConfig,
  subscribeArenaCommand,
  subscribeArenaConfig,
  subscribeArenaLog,
  subscribeArenaReset
} from "@/lib/game/arenaBus";
import {
  DEFAULT_ARENA_CONFIG,
  DIFFICULTY_AI_DAMAGE_MULTIPLIER,
  MAX_BIT,
  MAX_HP
} from "@/lib/game/constants";
import { ArenaConfig, ArenaLog, BeybladeId, GameCommand } from "@/lib/game/types";
import {
  ATTACK_COOLDOWN_HIT_MS,
  ATTACK_COOLDOWN_MISS_MS,
  ATTACK_STRIKE_DELAY_MS,
  DODGE_COOLDOWN_AI_MS,
  DODGE_COOLDOWN_PLAYER_MS
} from "@/game/arena/constants";
import { ArenaTrainerUi } from "@/game/arena/trainerUi";
import { ActorId } from "@/game/arena/types";
import { clamp, logId } from "@/game/arena/utils";
import { ArenaVisualRig } from "@/game/arena/visualRig";

export class BeybladeArenaScene extends Phaser.Scene {
  private config: ArenaConfig = DEFAULT_ARENA_CONFIG;
  private visuals?: ArenaVisualRig;
  private trainerUi?: ArenaTrainerUi;

  private playerHp = MAX_HP;
  private aiHp = MAX_HP;
  private playerBit = 0;
  private aiBit = 0;
  private winner: ActorId | null = null;

  private playerLockedUntil = 0;
  private aiLockedUntil = 0;
  private playerDodgeLockedUntil = 0;
  private aiDodgeLockedUntil = 0;
  private playerDodgingUntil = 0;
  private aiDodgingUntil = 0;
  private playerCooldownNoticeAt = 0;
  private aiThinkClock = 0;

  private offCommand?: () => void;
  private offConfig?: () => void;
  private offReset?: () => void;
  private offArenaLog?: () => void;

  constructor() {
    super("arena");
  }

  preload(): void {
    if (!this.visuals) {
      this.visuals = new ArenaVisualRig(this);
    }
    this.visuals.preload();
  }

  create(): void {
    this.config = getArenaConfig();

    if (!this.visuals) {
      this.visuals = new ArenaVisualRig(this);
    }
    if (!this.trainerUi) {
      this.trainerUi = new ArenaTrainerUi(this, (bladeId) =>
        this.resolveBladeColor(bladeId)
      );
    }

    this.visuals.create(this.config);
    this.trainerUi.render(this.config);

    this.attachListeners();
    this.broadcastState();
    this.emitSystem("Arena ready.");
  }

  update(time: number, delta: number): void {
    const visuals = this.visuals;
    if (!visuals) {
      return;
    }

    visuals.update(time, delta, {
      player: this.playerHp / MAX_HP,
      ai: this.aiHp / MAX_HP
    });

    if (visuals.inHitStop(time) || this.winner) {
      return;
    }

    this.aiThinkClock += delta;
    if (this.aiThinkClock >= aiActionDelay(this.config.difficulty)) {
      this.aiThinkClock = 0;
      this.performAiAction(time);
    }
  }

  private resolveBladeColor(bladeId: BeybladeId): number {
    return Phaser.Display.Color.HexStringToColor(BEYBLADES[bladeId].color).color;
  }

  private attachListeners(): void {
    this.offCommand = subscribeArenaCommand((command) => {
      this.performAction("player", command, true);
    });

    this.offArenaLog = subscribeArenaLog((log: ArenaLog) => {
      if (log.kind !== "trash") {
        return;
      }

      if (log.speaker === "player" || log.speaker === "ai") {
        this.trainerUi?.showTrashBubble(log.speaker, log.text);
      }
    });

    this.offConfig = subscribeArenaConfig((config) => {
      this.config = config;
      this.visuals?.applyConfig(config);
      this.trainerUi?.render(config);
      this.resetFight();
      this.emitSystem("Match ready.");
    });

    this.offReset = subscribeArenaReset(() => {
      this.resetFight();
      this.emitSystem("Match reset.");
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offCommand?.();
      this.offConfig?.();
      this.offReset?.();
      this.offArenaLog?.();
      this.trainerUi?.destroy();
      this.visuals?.destroy();
    });
  }

  private getActorLock(actor: ActorId): number {
    return actor === "player" ? this.playerLockedUntil : this.aiLockedUntil;
  }

  private getActorDodgeLock(actor: ActorId): number {
    return actor === "player" ? this.playerDodgeLockedUntil : this.aiDodgeLockedUntil;
  }

  private setActorLock(actor: ActorId, lockUntil: number): void {
    if (actor === "player") {
      this.playerLockedUntil = lockUntil;
      return;
    }
    this.aiLockedUntil = lockUntil;
  }

  private setActorDodgeLock(actor: ActorId, lockUntil: number): void {
    if (actor === "player") {
      this.playerDodgeLockedUntil = lockUntil;
      return;
    }
    this.aiDodgeLockedUntil = lockUntil;
  }

  private applyCooldown(actor: ActorId, cooldownMs: number): void {
    const nextLock = this.time.now + cooldownMs;
    const currentLock = this.getActorLock(actor);
    this.setActorLock(actor, Math.max(currentLock, nextLock));
  }

  private getDodgeCooldown(actor: ActorId): number {
    if (actor === "player") {
      return DODGE_COOLDOWN_PLAYER_MS;
    }

    if (this.config.difficulty === "easy") {
      return DODGE_COOLDOWN_AI_MS + 1200;
    }

    if (this.config.difficulty === "hard") {
      return DODGE_COOLDOWN_AI_MS - 140;
    }

    return DODGE_COOLDOWN_AI_MS;
  }

  private getAttackRecoveryCooldown(actor: ActorId, hit: boolean): number {
    if (actor === "player") {
      return hit ? ATTACK_COOLDOWN_HIT_MS : ATTACK_COOLDOWN_MISS_MS;
    }

    if (this.config.difficulty === "easy") {
      return hit
        ? ATTACK_COOLDOWN_HIT_MS + 920
        : ATTACK_COOLDOWN_MISS_MS + 1400;
    }

    if (this.config.difficulty === "hard") {
      return hit ? ATTACK_COOLDOWN_HIT_MS - 90 : ATTACK_COOLDOWN_MISS_MS - 120;
    }

    return hit ? ATTACK_COOLDOWN_HIT_MS : ATTACK_COOLDOWN_MISS_MS;
  }

  private performAiAction(time: number): void {
    if (time < this.aiLockedUntil || this.winner) {
      return;
    }

    if (this.config.difficulty === "easy" && Math.random() < 0.68) {
      return;
    }

    const action = decideAiAction({
      difficulty: this.config.difficulty,
      aiBit: this.aiBit,
      aiHp: this.aiHp,
      playerHp: this.playerHp
    });

    this.performAction("ai", action, false);
  }

  private performAction(actor: ActorId, command: GameCommand, fromUser: boolean): void {
    if (this.winner) {
      return;
    }

    const visuals = this.visuals;
    const now = this.time.now;
    if (visuals?.inHitStop(now)) {
      return;
    }

    if (command === "dodge") {
      const dodgeLock = this.getActorDodgeLock(actor);
      if (now < dodgeLock) {
        if (fromUser && now > this.playerCooldownNoticeAt) {
          const waitSec = ((dodgeLock - now) / 1000).toFixed(1);
          this.emitSystem(`Dodge cooldown (${waitSec}s).`);
          this.playerCooldownNoticeAt = now + 280;
        }
        return;
      }

      this.performDodge(actor);
      return;
    }

    const lock = this.getActorLock(actor);
    if (now < lock) {
      if (fromUser && now > this.playerCooldownNoticeAt) {
        const waitSec = ((lock - now) / 1000).toFixed(1);
        this.emitSystem(`Attack cooldown (${waitSec}s).`);
        this.playerCooldownNoticeAt = now + 280;
      }
      return;
    }

    if (command === "bit-beast") {
      if (!this.canUseBitBeast(actor)) {
        if (fromUser) {
          this.emitSystem("Bit Beast is not ready.");
        }
        return;
      }

      this.performBitBeast(actor);
      return;
    }

    this.performAttack(actor);
  }

  private performDodge(actor: ActorId): void {
    const now = this.time.now;
    this.visuals?.playDodgeAnimation(actor);
    this.setActorDodgeLock(actor, now + this.getDodgeCooldown(actor));

    if (actor === "player") {
      this.playerDodgingUntil = now + 320;
      this.emitLog("player", "Dodge!", "combat");
      return;
    }

    this.aiDodgingUntil = now + 320;
    this.emitLog("ai", "AI dodges.", "combat");
  }

  private performAttack(actor: ActorId): void {
    this.visuals?.playAttackAnimation(actor);
    this.applyCooldown(actor, ATTACK_STRIKE_DELAY_MS + 80);

    if (actor === "player") {
      this.emitLog("player", "Attack!", "combat");

      if (aiMayReactivelyDodge(this.config.difficulty) && this.time.now > this.aiLockedUntil + 40) {
        this.time.delayedCall(120, () => {
          if (!this.winner) {
            this.performDodge("ai");
          }
        });
      }

      this.time.delayedCall(ATTACK_STRIKE_DELAY_MS, () => this.resolveAttack("player"));
      return;
    }

    this.emitLog("ai", "AI attacks.", "combat");
    this.time.delayedCall(ATTACK_STRIKE_DELAY_MS, () => this.resolveAttack("ai"));
  }

  private performBitBeast(actor: ActorId): void {
    const now = this.time.now;
    this.visuals?.playBitBeastCast(actor);

    if (actor === "player") {
      this.playerLockedUntil = now + 1400;
      this.playerBit = 0;
      this.emitLog("player", `${BEYBLADES[this.config.playerBlade].bitBeast}!`, "combat");
      this.time.delayedCall(250, () => this.applyGuaranteedDamage("player", 30));
      return;
    }

    this.aiLockedUntil = now + 1400;
    this.aiBit = 0;
    this.emitLog("ai", `${BEYBLADES[this.config.aiBlade].bitBeast}!`, "combat");
    emitTauntRequest({ trigger: "ai-bit-beast" });
    this.time.delayedCall(250, () => this.applyGuaranteedDamage("ai", 30));
  }

  private resolveAttack(attacker: ActorId): void {
    if (this.winner) {
      return;
    }

    const now = this.time.now;

    if (attacker === "player") {
      if (this.aiDodgingUntil > now) {
        this.applyCooldown("player", this.getAttackRecoveryCooldown("player", false));
        this.playerBit = clamp(this.playerBit + 10, 0, MAX_BIT);
        this.aiBit = clamp(this.aiBit + 14, 0, MAX_BIT);
        this.visuals?.showMissEffect("ai");
        this.emitLog("system", "Missed. AI dodged.", "combat");
        emitTauntRequest({ trigger: "ai-dodge" });
        this.broadcastState();
        return;
      }

      const damage = 12 + Math.floor(Math.random() * 8);
      this.applyCooldown("player", this.getAttackRecoveryCooldown("player", true));
      this.aiHp = clamp(this.aiHp - damage, 0, MAX_HP);
      this.playerBit = clamp(this.playerBit + 18, 0, MAX_BIT);
      this.visuals?.showImpactEffect("ai", damage, false);
      this.emitLog("system", `Hit for ${damage}.`, "combat");
      this.maybeFinish();
      this.broadcastState();
      return;
    }

    if (this.playerDodgingUntil > now) {
      this.applyCooldown("ai", this.getAttackRecoveryCooldown("ai", false));
      this.aiBit = clamp(this.aiBit + 10, 0, MAX_BIT);
      this.playerBit = clamp(this.playerBit + 14, 0, MAX_BIT);
      this.visuals?.showMissEffect("player");
      this.emitLog("system", "Dodge successful.", "combat");
      this.broadcastState();
      return;
    }

    const rawDamage = 12 + Math.floor(Math.random() * 9);
    const damage = Math.max(
      4,
      Math.round(rawDamage * DIFFICULTY_AI_DAMAGE_MULTIPLIER[this.config.difficulty])
    );
    this.applyCooldown("ai", this.getAttackRecoveryCooldown("ai", true));
    this.playerHp = clamp(this.playerHp - damage, 0, MAX_HP);
    this.aiBit = clamp(this.aiBit + 18, 0, MAX_BIT);
    this.visuals?.showImpactEffect("player", damage, false);
    this.emitLog("system", `AI hit for ${damage}.`, "combat");
    emitTauntRequest({ trigger: "ai-hit" });
    this.maybeFinish();
    this.broadcastState();
  }

  private applyGuaranteedDamage(attacker: ActorId, damage: number): void {
    if (this.winner) {
      return;
    }

    if (attacker === "player") {
      this.aiHp = clamp(this.aiHp - damage, 0, MAX_HP);
      this.visuals?.showImpactEffect("ai", damage, true);
      this.emitLog("system", `Bit Beast hit AI for ${damage}.`, "combat");
    } else {
      const scaledDamage = Math.max(
        10,
        Math.round(damage * DIFFICULTY_AI_DAMAGE_MULTIPLIER[this.config.difficulty])
      );
      this.playerHp = clamp(this.playerHp - scaledDamage, 0, MAX_HP);
      this.visuals?.showImpactEffect("player", scaledDamage, true);
      this.emitLog("system", `AI Bit Beast hit for ${scaledDamage}.`, "combat");
    }

    this.maybeFinish();
    this.broadcastState();
  }

  private canUseBitBeast(actor: ActorId): boolean {
    return actor === "player" ? this.playerBit >= MAX_BIT : this.aiBit >= MAX_BIT;
  }

  private maybeFinish(): void {
    if (this.playerHp <= 0) {
      this.winner = "ai";
      this.emitSystem("KO. AI wins.");
      emitTauntRequest({ trigger: "player-miss" });
    } else if (this.aiHp <= 0) {
      this.winner = "player";
      this.emitSystem("KO. You win.");
    }
  }

  private resetFight(): void {
    this.playerHp = MAX_HP;
    this.aiHp = MAX_HP;
    this.playerBit = 0;
    this.aiBit = 0;
    this.winner = null;
    this.playerLockedUntil = 0;
    this.aiLockedUntil = 0;
    this.playerDodgeLockedUntil = 0;
    this.aiDodgeLockedUntil = 0;
    this.playerDodgingUntil = 0;
    this.aiDodgingUntil = 0;
    this.playerCooldownNoticeAt = 0;
    this.aiThinkClock = 0;

    this.trainerUi?.hideAllBubbles();
    this.visuals?.resetAll();
    this.broadcastState();
  }

  private emitLog(
    speaker: "player" | "ai" | "system",
    text: string,
    kind: "combat" | "trash"
  ): void {
    emitArenaLog({
      id: logId(),
      speaker,
      text,
      kind,
      timestamp: Date.now()
    });
  }

  private emitSystem(text: string): void {
    this.emitLog("system", text, "combat");
  }

  private broadcastState(): void {
    emitArenaState({
      playerHp: this.playerHp,
      aiHp: this.aiHp,
      playerBit: this.playerBit,
      aiBit: this.aiBit,
      roundTimeMs: this.time.now,
      winner: this.winner
    });
  }
}

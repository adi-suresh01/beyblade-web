import Phaser from "phaser";
import { decideAiAction, aiActionDelay, aiMayReactivelyDodge } from "@/lib/game/ai";
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
import { ArenaConfig, ArenaLog, GameCommand } from "@/lib/game/types";

interface SpeechBubble {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
}

interface MotionOffsets {
  dashX: number;
  pushX: number;
  dodgeX: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

const ATTACK_STRIKE_DELAY_MS = 230;
const ATTACK_COOLDOWN_HIT_MS = 340;
const ATTACK_COOLDOWN_MISS_MS = 980;
const DODGE_COOLDOWN_PLAYER_MS = 760;
const DODGE_COOLDOWN_AI_MS = 860;
const ATTACK_LUNGE_DISTANCE = 170;

export class BeybladeArenaScene extends Phaser.Scene {
  private config: ArenaConfig = DEFAULT_ARENA_CONFIG;

  private playerToken?: Phaser.GameObjects.Arc;
  private aiToken?: Phaser.GameObjects.Arc;

  private playerTrainer?: Phaser.GameObjects.Container;
  private aiTrainer?: Phaser.GameObjects.Container;

  private playerBubble?: SpeechBubble;
  private aiBubble?: SpeechBubble;
  private playerBubbleTimer?: Phaser.Time.TimerEvent;
  private aiBubbleTimer?: Phaser.Time.TimerEvent;

  private playerHp = MAX_HP;
  private aiHp = MAX_HP;
  private playerBit = 0;
  private aiBit = 0;
  private winner: "player" | "ai" | null = null;

  private playerLockedUntil = 0;
  private aiLockedUntil = 0;
  private playerDodgingUntil = 0;
  private aiDodgingUntil = 0;
  private motion: { player: MotionOffsets; ai: MotionOffsets } = {
    player: { dashX: 0, pushX: 0, dodgeX: 0 },
    ai: { dashX: 0, pushX: 0, dodgeX: 0 }
  };

  private aiThinkClock = 0;

  private offCommand?: () => void;
  private offConfig?: () => void;
  private offReset?: () => void;
  private offArenaLog?: () => void;

  constructor() {
    super("arena");
  }

  create(): void {
    this.config = getArenaConfig();

    this.add.rectangle(400, 210, 760, 360, 0x0a1630, 0.9).setStrokeStyle(3, 0x264071, 0.85);
    this.add.circle(400, 210, 140, 0x13295a, 0.5).setStrokeStyle(2, 0x2a4f8f, 0.7);

    this.playerToken = this.add
      .circle(220, 210, 24, this.resolveBladeColor(this.config.playerBlade), 1)
      .setDepth(12);
    this.aiToken = this.add
      .circle(580, 210, 24, this.resolveBladeColor(this.config.aiBlade), 1)
      .setDepth(12);

    this.renderTrainerModels();
    this.renderTrashBubbles();

    this.attachListeners();
    this.broadcastState();
    this.emitSystem(
      `Arena online. ${BEYBLADES[this.config.playerBlade].name} vs ${BEYBLADES[this.config.aiBlade].name}.`
    );
  }

  update(time: number, delta: number): void {
    if (!this.playerToken || !this.aiToken) {
      return;
    }

    this.animateTokens();

    if (this.winner) {
      return;
    }

    this.aiThinkClock += delta;
    if (this.aiThinkClock >= aiActionDelay(this.config.difficulty)) {
      this.aiThinkClock = 0;
      this.performAiAction(time);
    }
  }

  private resolveBladeColor(bladeId: ArenaConfig["playerBlade"]): number {
    return Phaser.Display.Color.HexStringToColor(BEYBLADES[bladeId].color).color;
  }

  private renderTrainerModels(): void {
    this.playerTrainer?.destroy(true);
    this.aiTrainer?.destroy(true);

    this.playerTrainer = this.createTrainerModel(130, 300, "YOU", this.resolveBladeColor(this.config.playerBlade), "right");
    this.aiTrainer = this.createTrainerModel(670, 300, "AI", this.resolveBladeColor(this.config.aiBlade), "left");
  }

  private createTrainerModel(
    x: number,
    y: number,
    label: string,
    jacketColor: number,
    facing: "left" | "right"
  ): Phaser.GameObjects.Container {
    const head = this.add
      .circle(0, -42, 12, 0xf4d7b7, 1)
      .setStrokeStyle(2, 0x1b2746, 0.95);
    const torso = this.add
      .rectangle(0, -12, 24, 40, jacketColor, 1)
      .setStrokeStyle(2, 0x1b2746, 0.95);
    const legLeft = this.add.rectangle(-7, 18, 8, 20, 0x1a2c57, 1);
    const legRight = this.add.rectangle(7, 18, 8, 20, 0x1a2c57, 1);

    const launcherOffset = facing === "right" ? 20 : -20;
    const launcher = this.add
      .rectangle(launcherOffset, -16, 20, 9, 0xd7dfef, 1)
      .setStrokeStyle(1, 0x1b2746, 0.95);
    const cordEnd = facing === "right" ? 16 : -16;
    const cord = this.add
      .line(launcherOffset + (facing === "right" ? 8 : -8), -16, 0, 0, cordEnd, 16, 0xffffff, 0.9)
      .setLineWidth(2, 2);

    const title = this.add
      .text(0, -66, label, {
        fontFamily: "Sora, sans-serif",
        fontSize: "12px",
        fontStyle: "700",
        color: "#e6f0ff"
      })
      .setOrigin(0.5);

    return this.add
      .container(x, y, [head, torso, legLeft, legRight, launcher, cord, title])
      .setDepth(8);
  }

  private renderTrashBubbles(): void {
    this.playerBubble?.container.destroy(true);
    this.aiBubble?.container.destroy(true);

    this.playerBubble = this.createTrashBubble(180, 92, "left");
    this.aiBubble = this.createTrashBubble(620, 92, "right");
  }

  private createTrashBubble(
    x: number,
    y: number,
    side: "left" | "right"
  ): SpeechBubble {
    const bubbleBg = this.add
      .rectangle(0, 0, 250, 68, 0x12203f, 0.97)
      .setStrokeStyle(2, 0xe6f0ff, 0.3);
    const tailX = side === "left" ? -76 : 76;
    const tail = this.add
      .triangle(tailX, 30, 0, 0, 14, 0, 7, 14, 0x12203f, 0.97)
      .setStrokeStyle(2, 0xe6f0ff, 0.3);
    const text = this.add
      .text(0, -2, "", {
        fontFamily: "Sora, sans-serif",
        fontSize: "13px",
        color: "#f7fbff",
        align: "center",
        wordWrap: { width: 220, useAdvancedWrap: true }
      })
      .setOrigin(0.5);

    const container = this.add
      .container(x, y, [bubbleBg, tail, text])
      .setDepth(24)
      .setVisible(false)
      .setAlpha(0);

    return { container, text };
  }

  private showTrashBubble(speaker: "player" | "ai", content: string): void {
    const bubble = speaker === "player" ? this.playerBubble : this.aiBubble;
    if (!bubble) {
      return;
    }

    const text = content.trim();
    if (!text) {
      return;
    }

    const clip = text.length > 110 ? `${text.slice(0, 107)}...` : text;
    bubble.text.setText(clip);

    this.tweens.killTweensOf(bubble.container);
    bubble.container.setVisible(true).setAlpha(0).setScale(0.88);
    this.tweens.add({
      targets: bubble.container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 170,
      ease: "Back.Out"
    });

    if (speaker === "player") {
      this.playerBubbleTimer?.remove(false);
      this.playerBubbleTimer = this.time.delayedCall(2600, () => {
        this.hideBubble(this.playerBubble);
      });
      return;
    }

    this.aiBubbleTimer?.remove(false);
    this.aiBubbleTimer = this.time.delayedCall(2600, () => {
      this.hideBubble(this.aiBubble);
    });
  }

  private hideBubble(bubble?: SpeechBubble): void {
    if (!bubble) {
      return;
    }

    this.tweens.killTweensOf(bubble.container);
    this.tweens.add({
      targets: bubble.container,
      alpha: 0,
      duration: 170,
      ease: "Sine.In",
      onComplete: () => {
        bubble.container.setVisible(false);
      }
    });
  }

  private hideAllBubbles(): void {
    this.hideBubble(this.playerBubble);
    this.hideBubble(this.aiBubble);
  }

  private animateTokens(): void {
    if (!this.playerToken || !this.aiToken) {
      return;
    }

    const t = this.time.now / 650;
    const orbit = 30;

    this.playerToken.x =
      220 +
      Math.sin(t * 1.8) * orbit +
      this.motion.player.dashX +
      this.motion.player.pushX +
      this.motion.player.dodgeX;
    this.playerToken.y = 210 + Math.cos(t * 1.2) * orbit;

    this.aiToken.x =
      580 +
      Math.sin(t * 1.4 + 1.2) * orbit +
      this.motion.ai.dashX +
      this.motion.ai.pushX +
      this.motion.ai.dodgeX;
    this.aiToken.y = 210 + Math.cos(t * 1.6 + 0.7) * orbit;

    this.playerToken.x = clamp(this.playerToken.x, 80, 430);
    this.aiToken.x = clamp(this.aiToken.x, 370, 720);
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
        this.showTrashBubble(log.speaker, log.text);
      }
    });

    this.offConfig = subscribeArenaConfig((config) => {
      this.config = config;
      this.applyBladeStyles();
      this.renderTrainerModels();
      this.resetFight();
      this.emitSystem(
        `New match config: ${BEYBLADES[config.playerBlade].name} vs ${BEYBLADES[config.aiBlade].name}.`
      );
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
      this.playerBubbleTimer?.remove(false);
      this.aiBubbleTimer?.remove(false);
    });
  }

  private applyBladeStyles(): void {
    if (this.playerToken) {
      this.playerToken.fillColor = this.resolveBladeColor(this.config.playerBlade);
    }

    if (this.aiToken) {
      this.aiToken.fillColor = this.resolveBladeColor(this.config.aiBlade);
    }
  }

  private getActorLock(actor: "player" | "ai"): number {
    return actor === "player" ? this.playerLockedUntil : this.aiLockedUntil;
  }

  private setActorLock(actor: "player" | "ai", lockUntil: number): void {
    if (actor === "player") {
      this.playerLockedUntil = lockUntil;
      return;
    }
    this.aiLockedUntil = lockUntil;
  }

  private applyCooldown(actor: "player" | "ai", cooldownMs: number): void {
    const nextLock = this.time.now + cooldownMs;
    const currentLock = this.getActorLock(actor);
    this.setActorLock(actor, Math.max(currentLock, nextLock));
  }

  private getDodgeCooldown(actor: "player" | "ai"): number {
    if (actor === "player") {
      return DODGE_COOLDOWN_PLAYER_MS;
    }

    return this.config.difficulty === "easy"
      ? DODGE_COOLDOWN_AI_MS + 240
      : DODGE_COOLDOWN_AI_MS;
  }

  private getAttackRecoveryCooldown(actor: "player" | "ai", hit: boolean): number {
    if (actor === "player") {
      return hit ? ATTACK_COOLDOWN_HIT_MS : ATTACK_COOLDOWN_MISS_MS;
    }

    if (this.config.difficulty === "easy") {
      return hit ? ATTACK_COOLDOWN_HIT_MS + 220 : ATTACK_COOLDOWN_MISS_MS + 260;
    }

    if (this.config.difficulty === "hard") {
      return hit ? ATTACK_COOLDOWN_HIT_MS - 70 : ATTACK_COOLDOWN_MISS_MS - 100;
    }

    return hit ? ATTACK_COOLDOWN_HIT_MS : ATTACK_COOLDOWN_MISS_MS;
  }

  private performAiAction(time: number): void {
    if (time < this.aiLockedUntil || this.winner) {
      return;
    }

    if (this.config.difficulty === "easy" && Math.random() < 0.28) {
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

  private performAction(actor: "player" | "ai", command: GameCommand, fromUser: boolean): void {
    if (this.winner) {
      return;
    }

    const now = this.time.now;
    const lock = this.getActorLock(actor);

    if (now < lock) {
      return;
    }

    if (command === "dodge") {
      this.performDodge(actor);
      return;
    }

    if (command === "bit-beast") {
      if (!this.canUseBitBeast(actor)) {
        if (fromUser) {
          this.emitSystem("Bit Beast is not ready yet.");
        }
        return;
      }
      this.performBitBeast(actor);
      return;
    }

    this.performAttack(actor);
  }

  private performDodge(actor: "player" | "ai"): void {
    const now = this.time.now;

    this.playDodgeAnimation(actor);
    this.applyCooldown(actor, this.getDodgeCooldown(actor));

    if (actor === "player") {
      this.playerDodgingUntil = now + 320;
      this.emitLog("player", "Dodge!", "combat");
      return;
    }

    this.aiDodgingUntil = now + 320;
    this.emitLog("ai", "AI slips out of range.", "combat");
  }

  private performAttack(actor: "player" | "ai"): void {
    this.playAttackAnimation(actor);
    this.applyCooldown(actor, ATTACK_STRIKE_DELAY_MS + 50);

    if (actor === "player") {
      this.emitLog("player", "Attack launched.", "combat");

      if (
        aiMayReactivelyDodge(this.config.difficulty) &&
        this.time.now > this.aiLockedUntil + 30
      ) {
        this.time.delayedCall(130, () => {
          if (!this.winner) {
            this.performDodge("ai");
          }
        });
      }

      this.time.delayedCall(ATTACK_STRIKE_DELAY_MS, () => this.resolveAttack("player"));
      return;
    }

    this.emitLog("ai", "AI attacks with pressure.", "combat");
    this.time.delayedCall(ATTACK_STRIKE_DELAY_MS, () => this.resolveAttack("ai"));
  }

  private performBitBeast(actor: "player" | "ai"): void {
    const now = this.time.now;
    this.playBitBeastCast(actor);

    if (actor === "player") {
      this.playerLockedUntil = now + 1400;
      this.playerBit = 0;
      this.emitLog("player", `${BEYBLADES[this.config.playerBlade].bitBeast} erupts!`, "combat");
      this.time.delayedCall(250, () => this.applyGuaranteedDamage("player", 30));
      return;
    }

    this.aiLockedUntil = now + 1400;
    this.aiBit = 0;
    this.emitLog("ai", `${BEYBLADES[this.config.aiBlade].bitBeast} overwhelms the arena!`, "combat");
    emitTauntRequest({ trigger: "ai-bit-beast" });
    this.time.delayedCall(250, () => this.applyGuaranteedDamage("ai", 30));
  }

  private resolveAttack(attacker: "player" | "ai"): void {
    if (this.winner) {
      return;
    }

    const now = this.time.now;

    if (attacker === "player") {
      if (this.aiDodgingUntil > now) {
        this.applyCooldown("player", this.getAttackRecoveryCooldown("player", false));
        this.playerBit = clamp(this.playerBit + 10, 0, MAX_BIT);
        this.aiBit = clamp(this.aiBit + 14, 0, MAX_BIT);
        this.showMissEffect("ai");
        this.emitLog("system", "Your attack missed. AI dodged cleanly.", "combat");
        emitTauntRequest({ trigger: "ai-dodge" });
        this.broadcastState();
        return;
      }

      const damage = 12 + Math.floor(Math.random() * 8);
      this.applyCooldown("player", this.getAttackRecoveryCooldown("player", true));
      this.aiHp = clamp(this.aiHp - damage, 0, MAX_HP);
      this.playerBit = clamp(this.playerBit + 18, 0, MAX_BIT);
      this.showImpactEffect("ai", damage, false);
      this.emitLog("system", `Hit confirmed for ${damage}.`, "combat");
      this.maybeFinish();
      this.broadcastState();
      return;
    }

    if (this.playerDodgingUntil > now) {
      this.applyCooldown("ai", this.getAttackRecoveryCooldown("ai", false));
      this.aiBit = clamp(this.aiBit + 10, 0, MAX_BIT);
      this.playerBit = clamp(this.playerBit + 14, 0, MAX_BIT);
      this.showMissEffect("player");
      this.emitLog("system", "Dodge successful. You avoided the hit.", "combat");
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
    this.showImpactEffect("player", damage, false);
    this.emitLog("system", `AI lands ${damage} damage.`, "combat");
    emitTauntRequest({ trigger: "ai-hit" });
    this.maybeFinish();
    this.broadcastState();
  }

  private applyGuaranteedDamage(attacker: "player" | "ai", damage: number): void {
    if (this.winner) {
      return;
    }

    if (attacker === "player") {
      this.aiHp = clamp(this.aiHp - damage, 0, MAX_HP);
      this.showImpactEffect("ai", damage, true);
      this.emitLog("system", `Bit Beast crushes AI for ${damage}.`, "combat");
    } else {
      const scaledDamage = Math.max(
        10,
        Math.round(damage * DIFFICULTY_AI_DAMAGE_MULTIPLIER[this.config.difficulty])
      );
      this.playerHp = clamp(this.playerHp - scaledDamage, 0, MAX_HP);
      this.showImpactEffect("player", scaledDamage, true);
      this.emitLog("system", `AI Bit Beast hits you for ${scaledDamage}.`, "combat");
    }

    this.maybeFinish();
    this.broadcastState();
  }

  private getToken(actor: "player" | "ai"): Phaser.GameObjects.Arc | undefined {
    return actor === "player" ? this.playerToken : this.aiToken;
  }

  private getMotion(actor: "player" | "ai"): MotionOffsets {
    return actor === "player" ? this.motion.player : this.motion.ai;
  }

  private playAttackAnimation(actor: "player" | "ai"): void {
    const token = this.getToken(actor);
    if (!token) {
      return;
    }

    const motion = this.getMotion(actor);
    const direction = actor === "player" ? 1 : -1;

    this.tweens.killTweensOf(token);
    this.tweens.killTweensOf(motion);
    token.setStrokeStyle(4, 0xffffff, 0.95);

    this.tweens.add({
      targets: token,
      scaleX: 1.33,
      scaleY: 1.33,
      duration: 110,
      yoyo: true,
      ease: "Sine.Out",
      onComplete: () => {
        token.setScale(1);
        token.setStrokeStyle(0, 0x000000, 0);
      }
    });

    this.tweens.add({
      targets: motion,
      dashX: direction * 72,
      duration: 120,
      ease: "Quad.Out",
      yoyo: true,
      onComplete: () => {
        motion.dashX = 0;
      }
    });
  }

  private playDodgeAnimation(actor: "player" | "ai"): void {
    const token = this.getToken(actor);
    if (!token) {
      return;
    }

    const motion = this.getMotion(actor);
    const direction = actor === "player" ? -1 : 1;

    this.tweens.killTweensOf(token);
    this.tweens.killTweensOf(motion);
    this.tweens.add({
      targets: token,
      alpha: 0.45,
      duration: 90,
      yoyo: true,
      repeat: 1,
      ease: "Sine.InOut",
      onComplete: () => {
        token.setAlpha(1);
      }
    });

    this.tweens.add({
      targets: motion,
      dodgeX: direction * 74,
      duration: 100,
      hold: 120,
      yoyo: true,
      ease: "Sine.Out",
      onComplete: () => {
        motion.dodgeX = 0;
      }
    });
  }

  private playBitBeastCast(actor: "player" | "ai"): void {
    const token = this.getToken(actor);
    if (!token) {
      return;
    }

    const auraColor = actor === "player" ? 0x4bc3ff : 0xff7a45;
    const aura = this.add.circle(token.x, token.y, 18, auraColor, 0.35).setDepth(16);

    this.tweens.add({
      targets: aura,
      scaleX: 8,
      scaleY: 8,
      alpha: 0,
      duration: 520,
      ease: "Cubic.Out",
      onComplete: () => {
        aura.destroy();
      }
    });

    this.cameras.main.shake(90, 0.0042);
  }

  private showImpactEffect(
    target: "player" | "ai",
    damage: number,
    bitBeast: boolean
  ): void {
    const token = this.getToken(target);
    if (!token) {
      return;
    }

    const flashColor = target === "player" ? 0xff5a7a : 0x4bc084;
    const burstScale = bitBeast ? 4.5 : 3.2;
    const motion = this.getMotion(target);
    const pushDirection = target === "player" ? -1 : 1;
    const pushAmount = bitBeast ? 58 : 34;

    const burst = this.add.circle(token.x, token.y, 12, flashColor, 0.7).setDepth(18);
    const damageText = this.add
      .text(token.x, token.y - 34, `-${damage}`, {
        fontFamily: "Sora, sans-serif",
        fontSize: bitBeast ? "24px" : "20px",
        fontStyle: "700",
        color: "#ffffff",
        stroke: "#0b1730",
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(19);

    this.tweens.add({
      targets: burst,
      scaleX: burstScale,
      scaleY: burstScale,
      alpha: 0,
      duration: bitBeast ? 420 : 290,
      ease: "Cubic.Out",
      onComplete: () => {
        burst.destroy();
      }
    });

    this.tweens.add({
      targets: damageText,
      y: damageText.y - 28,
      alpha: 0,
      duration: bitBeast ? 620 : 430,
      ease: "Sine.Out",
      onComplete: () => {
        damageText.destroy();
      }
    });

    this.tweens.killTweensOf(motion);
    this.tweens.add({
      targets: motion,
      pushX: pushDirection * pushAmount,
      duration: 95,
      ease: "Quad.Out",
      yoyo: true,
      onComplete: () => {
        motion.pushX = 0;
      }
    });

    this.cameras.main.shake(bitBeast ? 130 : 80, bitBeast ? 0.0062 : 0.0032);
  }

  private showMissEffect(target: "player" | "ai"): void {
    const token = this.getToken(target);
    if (!token) {
      return;
    }

    const missText = this.add
      .text(token.x, token.y - 30, "MISS", {
        fontFamily: "Sora, sans-serif",
        fontSize: "16px",
        fontStyle: "700",
        color: "#ffd84d",
        stroke: "#12203f",
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(18);

    this.tweens.add({
      targets: missText,
      y: missText.y - 18,
      alpha: 0,
      duration: 360,
      ease: "Sine.Out",
      onComplete: () => {
        missText.destroy();
      }
    });
  }

  private canUseBitBeast(actor: "player" | "ai"): boolean {
    return actor === "player" ? this.playerBit >= MAX_BIT : this.aiBit >= MAX_BIT;
  }

  private maybeFinish(): void {
    if (this.playerHp <= 0) {
      this.winner = "ai";
      this.emitSystem("KO. AI takes the match.");
      emitTauntRequest({ trigger: "player-miss" });
    } else if (this.aiHp <= 0) {
      this.winner = "player";
      this.emitSystem("KO. You win the match.");
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
    this.playerDodgingUntil = 0;
    this.aiDodgingUntil = 0;
    this.motion.player.dashX = 0;
    this.motion.player.pushX = 0;
    this.motion.player.dodgeX = 0;
    this.motion.ai.dashX = 0;
    this.motion.ai.pushX = 0;
    this.motion.ai.dodgeX = 0;
    this.aiThinkClock = 0;
    this.hideAllBubbles();
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

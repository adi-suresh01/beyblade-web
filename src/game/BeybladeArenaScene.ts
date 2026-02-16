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
import { ArenaConfig, ArenaLog, BEYBLADE_IDS, BeybladeId, GameCommand } from "@/lib/game/types";

type ActorId = "player" | "ai";

interface SpeechBubble {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
}

interface ActorVisual {
  shadow?: Phaser.GameObjects.Ellipse;
  glow?: Phaser.GameObjects.Ellipse;
  blade?: Phaser.GameObjects.Image;
}

interface ActorMotion {
  homeX: number;
  homeY: number;
  phase: number;
  spinDegPerSec: number;
  attackOffsetX: number;
  dodgeOffsetX: number;
  dodgeOffsetY: number;
  pushOffsetX: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

const ARENA_CENTER_X = 400;
const ARENA_CENTER_Y = 210;
const PLAYER_HOME_X = 232;
const AI_HOME_X = 568;
const PLAYER_HOME_Y = 208;
const AI_HOME_Y = 214;
const ORBIT_X = 18;
const ORBIT_Y = 13;
const BLADE_SIZE = 88;
const ATTACK_STRIKE_DELAY_MS = 220;
const ATTACK_COOLDOWN_HIT_MS = 360;
const ATTACK_COOLDOWN_MISS_MS = 960;
const DODGE_COOLDOWN_PLAYER_MS = 760;
const DODGE_COOLDOWN_AI_MS = 980;
const ATTACK_LUNGE_DISTANCE = 310;
const ATTACK_LUNGE_IN_MS = 160;
const ATTACK_LUNGE_HOLD_MS = 45;

export class BeybladeArenaScene extends Phaser.Scene {
  private config: ArenaConfig = DEFAULT_ARENA_CONFIG;

  private visuals: Record<ActorId, ActorVisual> = {
    player: {},
    ai: {}
  };

  private motion: Record<ActorId, ActorMotion> = {
    player: {
      homeX: PLAYER_HOME_X,
      homeY: PLAYER_HOME_Y,
      phase: 0.3,
      spinDegPerSec: 1120,
      attackOffsetX: 0,
      dodgeOffsetX: 0,
      dodgeOffsetY: 0,
      pushOffsetX: 0
    },
    ai: {
      homeX: AI_HOME_X,
      homeY: AI_HOME_Y,
      phase: 1.2,
      spinDegPerSec: -1080,
      attackOffsetX: 0,
      dodgeOffsetX: 0,
      dodgeOffsetY: 0,
      pushOffsetX: 0
    }
  };

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
    for (const bladeId of BEYBLADE_IDS) {
      const baseKey = this.textureKey(bladeId);
      if (!this.textures.exists(baseKey)) {
        this.load.image(baseKey, `/beyblades/${bladeId}.png`);
      }
    }
  }

  create(): void {
    this.config = getArenaConfig();

    this.drawArenaBackdrop();
    this.renderBladeSprites();
    this.renderTrainerModels();
    this.renderTrashBubbles();

    this.attachListeners();
    this.broadcastState();
    this.emitSystem("Arena ready.");
  }

  update(time: number, delta: number): void {
    this.updateActorVisual("player", time, delta);
    this.updateActorVisual("ai", time, delta);

    if (this.winner) {
      return;
    }

    this.aiThinkClock += delta;
    if (this.aiThinkClock >= aiActionDelay(this.config.difficulty)) {
      this.aiThinkClock = 0;
      this.performAiAction(time);
    }
  }

  private textureKey(bladeId: BeybladeId): string {
    return `blade-${bladeId}`;
  }

  private resolveBladeColor(bladeId: BeybladeId): number {
    return Phaser.Display.Color.HexStringToColor(BEYBLADES[bladeId].color).color;
  }

  private drawArenaBackdrop(): void {
    this.add
      .rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, 760, 360, 0x081630, 0.95)
      .setStrokeStyle(3, 0x294c87, 0.85);

    this.add
      .circle(ARENA_CENTER_X, ARENA_CENTER_Y, 184, 0x10275a, 0.62)
      .setStrokeStyle(4, 0x3d70c4, 0.5);

    this.add
      .circle(ARENA_CENTER_X, ARENA_CENTER_Y, 132, 0x0a1836, 0.78)
      .setStrokeStyle(2, 0x4f89e8, 0.5);
  }

  private renderBladeSprites(): void {
    this.destroyActorVisual("player");
    this.destroyActorVisual("ai");

    this.visuals.player = this.createActorVisual("player", this.config.playerBlade);
    this.visuals.ai = this.createActorVisual("ai", this.config.aiBlade);

    this.updateActorVisual("player", this.time.now, 16);
    this.updateActorVisual("ai", this.time.now, 16);
  }

  private destroyActorVisual(actor: ActorId): void {
    const visual = this.visuals[actor];
    visual.shadow?.destroy();
    visual.glow?.destroy();
    visual.blade?.destroy();
    this.visuals[actor] = {};
  }

  private createActorVisual(actor: ActorId, bladeId: BeybladeId): ActorVisual {
    const color = this.resolveBladeColor(bladeId);

    const shadow = this.add
      .ellipse(0, 0, BLADE_SIZE * 0.88, BLADE_SIZE * 0.24, 0x000000, 0.35)
      .setDepth(9);

    const glow = this.add
      .ellipse(0, 0, BLADE_SIZE * 1.16, BLADE_SIZE * 1.16, color, 0.14)
      .setStrokeStyle(3, color, 0.92)
      .setDepth(10);

    const blade = this.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE, BLADE_SIZE)
      .setDepth(13)
      .setScale(1);

    if (actor === "ai") {
      blade.rotation = Math.PI;
    }

    return { shadow, glow, blade };
  }

  private updateActorVisual(actor: ActorId, time: number, delta: number): void {
    const visual = this.visuals[actor];
    const state = this.motion[actor];

    state.pushOffsetX *= 0.82;
    if (Math.abs(state.pushOffsetX) < 0.1) {
      state.pushOffsetX = 0;
    }

    const orbitX = Math.sin(time / 230 + state.phase) * ORBIT_X;
    const orbitY = Math.cos(time / 290 + state.phase) * ORBIT_Y;

    const x = clamp(
      state.homeX + orbitX + state.attackOffsetX + state.dodgeOffsetX + state.pushOffsetX,
      actor === "player" ? 70 : 220,
      actor === "player" ? 580 : 730
    );
    const y = state.homeY + orbitY + state.dodgeOffsetY;

    visual.shadow?.setPosition(x, y + BLADE_SIZE * 0.32).setScale(
      1 + Math.abs(state.attackOffsetX) / 560,
      1
    );

    visual.glow?.setPosition(x, y).setRotation(
      (time / 1200) * (actor === "player" ? 1 : -1)
    );

    if (visual.blade) {
      visual.blade.setPosition(x, y);
      visual.blade.rotation += Phaser.Math.DegToRad(state.spinDegPerSec) * (delta / 1000);
    }
  }

  private renderTrainerModels(): void {
    this.playerTrainer?.destroy(true);
    this.aiTrainer?.destroy(true);

    this.playerTrainer = this.createTrainerModel(
      122,
      308,
      "YOU",
      this.resolveBladeColor(this.config.playerBlade),
      "right"
    );
    this.aiTrainer = this.createTrainerModel(
      678,
      308,
      "AI",
      this.resolveBladeColor(this.config.aiBlade),
      "left"
    );
  }

  private createTrainerModel(
    x: number,
    y: number,
    label: string,
    jacketColor: number,
    facing: "left" | "right"
  ): Phaser.GameObjects.Container {
    const hair = this.add
      .ellipse(0, -49, 24, 16, 0x1e2b53, 1)
      .setStrokeStyle(1, 0x111a35, 0.95);

    const head = this.add
      .circle(0, -42, 12, 0xf8dbc3, 1)
      .setStrokeStyle(2, 0x1c2748, 0.95);

    const torso = this.add
      .rectangle(0, -12, 26, 40, jacketColor, 1)
      .setStrokeStyle(2, 0x1a2646, 0.95);

    const belt = this.add.rectangle(0, 2, 24, 5, 0xe8eefc, 0.92);
    const legLeft = this.add.rectangle(-8, 18, 9, 20, 0x1a2c57, 1);
    const legRight = this.add.rectangle(8, 18, 9, 20, 0x1a2c57, 1);

    const launcherOffset = facing === "right" ? 21 : -21;
    const launcher = this.add
      .rectangle(launcherOffset, -14, 22, 10, 0xe6eefc, 1)
      .setStrokeStyle(1, 0x1c2748, 0.9);

    const cord = this.add
      .line(
        launcherOffset + (facing === "right" ? 9 : -9),
        -14,
        0,
        0,
        facing === "right" ? 17 : -17,
        18,
        0xffffff,
        0.95
      )
      .setLineWidth(2, 2);

    const title = this.add
      .text(0, -68, label, {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: "15px",
        fontStyle: "700",
        color: "#f1f6ff",
        stroke: "#0c1834",
        strokeThickness: 4
      })
      .setOrigin(0.5);

    return this.add
      .container(x, y, [hair, head, torso, belt, legLeft, legRight, launcher, cord, title])
      .setDepth(8);
  }

  private renderTrashBubbles(): void {
    this.playerBubble?.container.destroy(true);
    this.aiBubble?.container.destroy(true);

    this.playerBubble = this.createTrashBubble(182, 92, "left");
    this.aiBubble = this.createTrashBubble(618, 92, "right");
  }

  private createTrashBubble(x: number, y: number, side: "left" | "right"): SpeechBubble {
    const bubbleBg = this.add
      .rectangle(0, 0, 258, 74, 0x102247, 0.96)
      .setStrokeStyle(2, 0xe8f2ff, 0.38);

    const tailX = side === "left" ? -80 : 80;
    const tail = this.add
      .triangle(tailX, 33, 0, 0, 14, 0, 7, 15, 0x102247, 0.96)
      .setStrokeStyle(2, 0xe8f2ff, 0.38);

    const text = this.add
      .text(0, -2, "", {
        fontFamily: "Rajdhani, Sora, sans-serif",
        fontSize: "14px",
        color: "#f7fbff",
        align: "center",
        wordWrap: { width: 226, useAdvancedWrap: true }
      })
      .setOrigin(0.5);

    const container = this.add
      .container(x, y, [bubbleBg, tail, text])
      .setDepth(24)
      .setVisible(false)
      .setAlpha(0);

    return { container, text };
  }

  private showTrashBubble(speaker: ActorId, content: string): void {
    const bubble = speaker === "player" ? this.playerBubble : this.aiBubble;
    if (!bubble) {
      return;
    }

    const text = content.trim();
    if (!text) {
      return;
    }

    const clippedText = text.length > 110 ? `${text.slice(0, 107)}...` : text;
    bubble.text.setText(clippedText);

    this.tweens.killTweensOf(bubble.container);
    bubble.container.setVisible(true).setAlpha(0).setScale(0.9);
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
      this.playerBubbleTimer?.remove(false);
      this.aiBubbleTimer?.remove(false);
    });
  }

  private applyBladeStyles(): void {
    this.setActorBlade("player", this.config.playerBlade);
    this.setActorBlade("ai", this.config.aiBlade);
  }

  private setActorBlade(actor: ActorId, bladeId: BeybladeId): void {
    const color = this.resolveBladeColor(bladeId);
    const visual = this.visuals[actor];

    visual.blade?.setTexture(this.textureKey(bladeId));
    visual.glow?.setFillStyle(color, 0.14).setStrokeStyle(3, color, 0.92);
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

    const now = this.time.now;

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

    this.playDodgeAnimation(actor);
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
    this.playAttackAnimation(actor);
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
    this.playBitBeastCast(actor);

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
        this.showMissEffect("ai");
        this.emitLog("system", "Missed. AI dodged.", "combat");
        emitTauntRequest({ trigger: "ai-dodge" });
        this.broadcastState();
        return;
      }

      const damage = 12 + Math.floor(Math.random() * 8);
      this.applyCooldown("player", this.getAttackRecoveryCooldown("player", true));
      this.aiHp = clamp(this.aiHp - damage, 0, MAX_HP);
      this.playerBit = clamp(this.playerBit + 18, 0, MAX_BIT);
      this.showImpactEffect("ai", damage, false);
      this.emitLog("system", `Hit for ${damage}.`, "combat");
      this.maybeFinish();
      this.broadcastState();
      return;
    }

    if (this.playerDodgingUntil > now) {
      this.applyCooldown("ai", this.getAttackRecoveryCooldown("ai", false));
      this.aiBit = clamp(this.aiBit + 10, 0, MAX_BIT);
      this.playerBit = clamp(this.playerBit + 14, 0, MAX_BIT);
      this.showMissEffect("player");
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
    this.showImpactEffect("player", damage, false);
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
      this.showImpactEffect("ai", damage, true);
      this.emitLog("system", `Bit Beast hit AI for ${damage}.`, "combat");
    } else {
      const scaledDamage = Math.max(
        10,
        Math.round(damage * DIFFICULTY_AI_DAMAGE_MULTIPLIER[this.config.difficulty])
      );
      this.playerHp = clamp(this.playerHp - scaledDamage, 0, MAX_HP);
      this.showImpactEffect("player", scaledDamage, true);
      this.emitLog("system", `AI Bit Beast hit for ${scaledDamage}.`, "combat");
    }

    this.maybeFinish();
    this.broadcastState();
  }

  private getToken(actor: ActorId): Phaser.GameObjects.Image | undefined {
    return this.visuals[actor].blade;
  }

  private getActorMotion(actor: ActorId): ActorMotion {
    return this.motion[actor];
  }

  private playAttackAnimation(actor: ActorId): void {
    const token = this.getToken(actor);
    const state = this.getActorMotion(actor);
    const direction = actor === "player" ? 1 : -1;

    this.tweens.killTweensOf(state);
    state.attackOffsetX = 0;

    this.tweens.add({
      targets: state,
      attackOffsetX: direction * ATTACK_LUNGE_DISTANCE,
      duration: ATTACK_LUNGE_IN_MS,
      ease: "Cubic.Out",
      yoyo: true,
      hold: ATTACK_LUNGE_HOLD_MS,
      onComplete: () => {
        state.attackOffsetX = 0;
      }
    });

    if (!token) {
      return;
    }

    this.tweens.killTweensOf(token);
    this.tweens.add({
      targets: token,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 110,
      yoyo: true,
      ease: "Sine.Out",
      onComplete: () => {
        token.setScale(1);
      }
    });
  }

  private playDodgeAnimation(actor: ActorId): void {
    const token = this.getToken(actor);
    const state = this.getActorMotion(actor);
    const horizontal = actor === "player" ? -74 : 74;
    const vertical = actor === "player" ? -36 : 36;

    this.tweens.killTweensOf(state);
    state.dodgeOffsetX = 0;
    state.dodgeOffsetY = 0;

    this.tweens.add({
      targets: state,
      dodgeOffsetX: horizontal,
      dodgeOffsetY: vertical,
      duration: 94,
      ease: "Sine.Out",
      yoyo: true,
      hold: 36,
      onComplete: () => {
        state.dodgeOffsetX = 0;
        state.dodgeOffsetY = 0;
      }
    });

    if (!token) {
      return;
    }

    this.tweens.killTweensOf(token);
    this.tweens.add({
      targets: token,
      alpha: 0.55,
      duration: 90,
      yoyo: true,
      repeat: 1,
      ease: "Sine.InOut",
      onComplete: () => {
        token.setAlpha(1).setScale(1);
      }
    });
  }

  private playBitBeastCast(actor: ActorId): void {
    const token = this.getToken(actor);
    if (!token) {
      return;
    }

    const auraColor = actor === "player" ? 0x55beff : 0xff8753;
    const aura = this.add.circle(token.x, token.y, 18, auraColor, 0.34).setDepth(16);

    this.tweens.add({
      targets: aura,
      scaleX: 8,
      scaleY: 8,
      alpha: 0,
      duration: 540,
      ease: "Cubic.Out",
      onComplete: () => {
        aura.destroy();
      }
    });

    this.cameras.main.shake(100, 0.0044);
  }

  private showImpactEffect(target: ActorId, damage: number, bitBeast: boolean): void {
    const token = this.getToken(target);
    if (!token) {
      return;
    }

    const flashColor = target === "player" ? 0xff5d7f : 0x4fd48c;
    const burstScale = bitBeast ? 4.6 : 3.3;
    const state = this.getActorMotion(target);
    const pushDirection = target === "player" ? -1 : 1;
    const pushAmount = bitBeast ? 92 : 64;

    const burst = this.add.circle(token.x, token.y, 12, flashColor, 0.72).setDepth(18);
    const damageText = this.add
      .text(token.x, token.y - 34, `-${damage}`, {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: bitBeast ? "28px" : "24px",
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
      duration: bitBeast ? 430 : 300,
      ease: "Cubic.Out",
      onComplete: () => {
        burst.destroy();
      }
    });

    this.tweens.add({
      targets: damageText,
      y: damageText.y - 30,
      alpha: 0,
      duration: bitBeast ? 620 : 440,
      ease: "Sine.Out",
      onComplete: () => {
        damageText.destroy();
      }
    });

    state.pushOffsetX = pushDirection * pushAmount;

    this.cameras.main.shake(bitBeast ? 132 : 84, bitBeast ? 0.006 : 0.0032);
  }

  private showMissEffect(target: ActorId): void {
    const token = this.getToken(target);
    if (!token) {
      return;
    }

    const missText = this.add
      .text(token.x, token.y - 32, "MISS", {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: "22px",
        fontStyle: "700",
        color: "#ffe16c",
        stroke: "#12203f",
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(18);

    this.tweens.add({
      targets: missText,
      y: missText.y - 18,
      alpha: 0,
      duration: 370,
      ease: "Sine.Out",
      onComplete: () => {
        missText.destroy();
      }
    });
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
    this.hideAllBubbles();

    this.resetActorMotion("player");
    this.resetActorMotion("ai");

    const playerToken = this.getToken("player");
    const aiToken = this.getToken("ai");
    playerToken?.setScale(1).setAlpha(1);
    aiToken?.setScale(1).setAlpha(1);

    this.broadcastState();
  }

  private resetActorMotion(actor: ActorId): void {
    const state = this.motion[actor];
    state.attackOffsetX = 0;
    state.dodgeOffsetX = 0;
    state.dodgeOffsetY = 0;
    state.pushOffsetX = 0;
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

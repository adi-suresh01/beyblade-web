import Phaser from "phaser";
import { BEYBLADES } from "@/lib/game/beyblades";
import { ArenaConfig, BEYBLADE_IDS, BeybladeId } from "@/lib/game/types";
import {
  AI_HOME_X,
  AI_HOME_Y,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ATTACK_CURVE_ARC_Y,
  ATTACK_LUNGE_DISTANCE,
  ATTACK_LUNGE_HOLD_MS,
  ATTACK_LUNGE_IN_MS,
  BIT_BEAST_HIT_STOP_MS,
  BLADE_SIZE,
  DODGE_ESCAPE_X,
  DODGE_ESCAPE_Y,
  IMPACT_HIT_STOP_MS,
  ORBIT_X,
  ORBIT_Y,
  PLAYER_HOME_X,
  PLAYER_HOME_Y
} from "@/game/arena/constants";
import { ActorId, ActorMotion, ActorVisual } from "@/game/arena/types";
import { clamp } from "@/game/arena/utils";

interface HpRatios {
  player: number;
  ai: number;
}

function makeMotion(actor: ActorId): ActorMotion {
  if (actor === "player") {
    return {
      homeX: PLAYER_HOME_X,
      homeY: PLAYER_HOME_Y,
      phase: 0.3,
      spinDegPerSec: 1120,
      attackOffsetX: 0,
      attackOffsetY: 0,
      dodgeOffsetX: 0,
      dodgeOffsetY: 0,
      pushOffsetX: 0,
      spinBoostUntil: 0
    };
  }

  return {
    homeX: AI_HOME_X,
    homeY: AI_HOME_Y,
    phase: 1.2,
    spinDegPerSec: -1080,
    attackOffsetX: 0,
    attackOffsetY: 0,
    dodgeOffsetX: 0,
    dodgeOffsetY: 0,
    pushOffsetX: 0,
    spinBoostUntil: 0
  };
}

function emptyVisual(): ActorVisual {
  return { trailNextAt: 0 };
}

export class ArenaVisualRig {
  private readonly scene: Phaser.Scene;

  private actorBlade: Record<ActorId, BeybladeId> = {
    player: "dragoon",
    ai: "driger"
  };

  private visuals: Record<ActorId, ActorVisual> = {
    player: emptyVisual(),
    ai: emptyVisual()
  };

  private motion: Record<ActorId, ActorMotion> = {
    player: makeMotion("player"),
    ai: makeMotion("ai")
  };

  private hitStopUntil = 0;
  private tweensPausedByHitStop = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  preload(): void {
    for (const bladeId of BEYBLADE_IDS) {
      const key = this.textureKey(bladeId);
      if (!this.scene.textures.exists(key)) {
        this.scene.load.image(key, `/beyblades/${bladeId}.png`);
      }
    }
  }

  create(config: ArenaConfig): void {
    this.actorBlade.player = config.playerBlade;
    this.actorBlade.ai = config.aiBlade;
    this.drawArenaBackdrop();
    this.visuals.player = this.createActorVisual("player", config.playerBlade);
    this.visuals.ai = this.createActorVisual("ai", config.aiBlade);
    this.updateActorVisual("player", this.scene.time.now, 16, 1);
    this.updateActorVisual("ai", this.scene.time.now, 16, 1);
  }

  destroy(): void {
    this.destroyActorVisual("player");
    this.destroyActorVisual("ai");

    if (this.tweensPausedByHitStop) {
      this.scene.tweens.resumeAll();
      this.tweensPausedByHitStop = false;
    }
  }

  inHitStop(now: number): boolean {
    return now < this.hitStopUntil;
  }

  update(time: number, delta: number, hpRatios: HpRatios): void {
    if (this.inHitStop(time)) {
      return;
    }

    this.updateActorVisual("player", time, delta, hpRatios.player);
    this.updateActorVisual("ai", time, delta, hpRatios.ai);
  }

  applyConfig(config: ArenaConfig): void {
    this.actorBlade.player = config.playerBlade;
    this.actorBlade.ai = config.aiBlade;
    this.setActorBlade("player", config.playerBlade);
    this.setActorBlade("ai", config.aiBlade);
  }

  getMotion(actor: ActorId): ActorMotion {
    return this.motion[actor];
  }

  resetActorMotion(actor: ActorId): void {
    const state = this.motion[actor];
    state.attackOffsetX = 0;
    state.attackOffsetY = 0;
    state.dodgeOffsetX = 0;
    state.dodgeOffsetY = 0;
    state.pushOffsetX = 0;
    state.spinBoostUntil = 0;
  }

  resetAll(): void {
    this.resetActorMotion("player");
    this.resetActorMotion("ai");
    this.hitStopUntil = 0;

    const player = this.visuals.player;
    const ai = this.visuals.ai;
    player.base?.setScale(1).setAlpha(1);
    player.ring?.setScale(1.05).setAlpha(0.28);
    player.highlight?.setScale(0.82).setAlpha(0.2);
    ai.base?.setScale(1).setAlpha(1);
    ai.ring?.setScale(1.05).setAlpha(0.28);
    ai.highlight?.setScale(0.82).setAlpha(0.2);

    if (this.tweensPausedByHitStop) {
      this.scene.tweens.resumeAll();
      this.tweensPausedByHitStop = false;
    }
  }

  playAttackAnimation(actor: ActorId): void {
    const state = this.motion[actor];
    const visual = this.visuals[actor];
    const direction = actor === "player" ? 1 : -1;
    const arcY = actor === "player" ? -ATTACK_CURVE_ARC_Y : ATTACK_CURVE_ARC_Y;

    this.scene.tweens.killTweensOf(state);
    state.attackOffsetX = 0;
    state.attackOffsetY = 0;
    state.spinBoostUntil = this.scene.time.now + 520;

    this.scene.tweens.add({
      targets: state,
      attackOffsetX: -direction * 24,
      attackOffsetY: arcY * 0.14,
      duration: 72,
      ease: "Quad.In",
      onComplete: () => {
        const start = new Phaser.Math.Vector2(state.attackOffsetX, state.attackOffsetY);
        const curve = new Phaser.Curves.CubicBezier(
          start,
          new Phaser.Math.Vector2(direction * 120, arcY),
          new Phaser.Math.Vector2(direction * 254, arcY * 0.34),
          new Phaser.Math.Vector2(direction * ATTACK_LUNGE_DISTANCE, 0)
        );

        this.animateCurve(curve, ATTACK_LUNGE_IN_MS, "Cubic.Out", (p) => {
          state.attackOffsetX = p.x;
          state.attackOffsetY = p.y;
        }, () => {
          this.scene.time.delayedCall(ATTACK_LUNGE_HOLD_MS, () => {
            this.scene.tweens.add({
              targets: state,
              attackOffsetX: 0,
              attackOffsetY: 0,
              duration: 190,
              ease: "Back.InOut"
            });
          });
        });
      }
    });

    if (visual.glow) {
      this.scene.tweens.add({
        targets: visual.glow,
        alpha: 0.32,
        duration: 90,
        yoyo: true,
        ease: "Sine.InOut"
      });
    }
  }

  playDodgeAnimation(actor: ActorId): void {
    const state = this.motion[actor];
    const visual = this.visuals[actor];
    const escapeX = actor === "player" ? -DODGE_ESCAPE_X : DODGE_ESCAPE_X;
    const escapeY = actor === "player" ? -DODGE_ESCAPE_Y : DODGE_ESCAPE_Y;

    this.scene.tweens.killTweensOf(state);
    state.dodgeOffsetX = 0;
    state.dodgeOffsetY = 0;
    state.spinBoostUntil = this.scene.time.now + 300;

    this.scene.tweens.add({
      targets: state,
      dodgeOffsetX: -escapeX * 0.24,
      dodgeOffsetY: escapeY * 0.16,
      duration: 55,
      ease: "Quad.In",
      onComplete: () => {
        const curve = new Phaser.Curves.CubicBezier(
          new Phaser.Math.Vector2(state.dodgeOffsetX, state.dodgeOffsetY),
          new Phaser.Math.Vector2(escapeX * 0.38, escapeY * 0.26),
          new Phaser.Math.Vector2(escapeX * 0.82, escapeY * 1.02),
          new Phaser.Math.Vector2(escapeX, escapeY * 0.88)
        );

        this.animateCurve(curve, 120, "Sine.Out", (p) => {
          state.dodgeOffsetX = p.x;
          state.dodgeOffsetY = p.y;
        }, () => {
          this.scene.time.delayedCall(40, () => {
            this.scene.tweens.add({
              targets: state,
              dodgeOffsetX: 0,
              dodgeOffsetY: 0,
              duration: 150,
              ease: "Back.InOut"
            });
          });
        });
      }
    });

    if (visual.base) {
      this.scene.tweens.killTweensOf(visual.base);
      this.scene.tweens.add({
        targets: visual.base,
        alpha: 0.48,
        duration: 90,
        yoyo: true,
        repeat: 1,
        ease: "Sine.InOut",
        onComplete: () => {
          visual.base?.setAlpha(1);
        }
      });
    }
  }

  playBitBeastCast(actor: ActorId): void {
    const visual = this.visuals[actor];
    const token = visual.base;
    if (!token) {
      return;
    }

    const now = this.scene.time.now;
    const color = actor === "player" ? 0x55beff : 0xff8753;
    this.motion[actor].spinBoostUntil = now + 820;

    const chargeRing = this.scene.add
      .circle(token.x, token.y, BLADE_SIZE * 0.48, color, 0.18)
      .setDepth(15)
      .setStrokeStyle(2, color, 0.78);

    this.scene.tweens.add({
      targets: chargeRing,
      scaleX: 1.9,
      scaleY: 1.9,
      alpha: 0,
      duration: 320,
      ease: "Cubic.Out",
      onComplete: () => {
        chargeRing.destroy();
      }
    });

    const aura = this.scene.add
      .circle(token.x, token.y, 18, color, 0.34)
      .setDepth(16)
      .setStrokeStyle(1, 0xffffff, 0.65);

    this.scene.tweens.add({
      targets: aura,
      scaleX: 8.8,
      scaleY: 8.8,
      alpha: 0,
      duration: 560,
      ease: "Cubic.Out",
      onComplete: () => {
        aura.destroy();
      }
    });

    this.scene.cameras.main.shake(110, 0.0048);
  }

  showImpactEffect(target: ActorId, damage: number, bitBeast: boolean): void {
    const token = this.visuals[target].base;
    if (!token) {
      return;
    }

    const flashColor = target === "player" ? 0xff5d7f : 0x4fd48c;
    const burstScale = bitBeast ? 4.8 : 3.35;
    const pushDirection = target === "player" ? -1 : 1;
    const pushAmount = bitBeast ? 92 : 64;
    const state = this.motion[target];

    state.pushOffsetX = pushDirection * pushAmount;
    state.spinBoostUntil = this.scene.time.now + (bitBeast ? 640 : 380);

    const burst = this.scene.add
      .circle(token.x, token.y, 12, flashColor, 0.72)
      .setDepth(18);

    const damageText = this.scene.add
      .text(token.x, token.y - 34, `-${damage}`, {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: bitBeast ? "30px" : "24px",
        fontStyle: "700",
        color: "#ffffff",
        stroke: "#0b1730",
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(19);

    this.emitImpactSparks(token.x, token.y, flashColor, bitBeast ? 11 : 8);

    this.scene.tweens.add({
      targets: burst,
      scaleX: burstScale,
      scaleY: burstScale,
      alpha: 0,
      duration: bitBeast ? 460 : 310,
      ease: "Cubic.Out",
      onComplete: () => {
        burst.destroy();
      }
    });

    this.scene.tweens.add({
      targets: damageText,
      y: damageText.y - 30,
      alpha: 0,
      duration: bitBeast ? 660 : 460,
      ease: "Sine.Out",
      onComplete: () => {
        damageText.destroy();
      }
    });

    this.applyHitStop(bitBeast ? BIT_BEAST_HIT_STOP_MS : IMPACT_HIT_STOP_MS);
    this.scene.cameras.main.shake(bitBeast ? 140 : 92, bitBeast ? 0.0068 : 0.0035);
  }

  showMissEffect(target: ActorId): void {
    const token = this.visuals[target].base;
    if (!token) {
      return;
    }

    const missText = this.scene.add
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

    this.scene.tweens.add({
      targets: missText,
      y: missText.y - 18,
      alpha: 0,
      duration: 380,
      ease: "Sine.Out",
      onComplete: () => {
        missText.destroy();
      }
    });
  }

  private drawArenaBackdrop(): void {
    this.scene.add
      .rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, 760, 360, 0x081630, 0.95)
      .setStrokeStyle(3, 0x294c87, 0.85);

    this.scene.add
      .circle(ARENA_CENTER_X, ARENA_CENTER_Y, 184, 0x10275a, 0.62)
      .setStrokeStyle(4, 0x3d70c4, 0.5);

    this.scene.add
      .circle(ARENA_CENTER_X, ARENA_CENTER_Y, 132, 0x0a1836, 0.78)
      .setStrokeStyle(2, 0x4f89e8, 0.5);
  }

  private textureKey(bladeId: BeybladeId): string {
    return `blade-${bladeId}`;
  }

  private resolveBladeColor(bladeId: BeybladeId): number {
    return Phaser.Display.Color.HexStringToColor(BEYBLADES[bladeId].color).color;
  }

  private destroyActorVisual(actor: ActorId): void {
    const visual = this.visuals[actor];
    visual.shadow?.destroy();
    visual.glow?.destroy();
    visual.base?.destroy();
    visual.ring?.destroy();
    visual.highlight?.destroy();
    this.visuals[actor] = emptyVisual();
  }

  private createActorVisual(actor: ActorId, bladeId: BeybladeId): ActorVisual {
    const color = this.resolveBladeColor(bladeId);

    const shadow = this.scene.add
      .ellipse(0, 0, BLADE_SIZE * 0.88, BLADE_SIZE * 0.24, 0x000000, 0.35)
      .setDepth(9);

    const glow = this.scene.add
      .ellipse(0, 0, BLADE_SIZE * 1.24, BLADE_SIZE * 1.24, color, 0.14)
      .setStrokeStyle(3, color, 0.9)
      .setDepth(10);

    const base = this.scene.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE, BLADE_SIZE)
      .setDepth(13)
      .setScale(1);

    const ring = this.scene.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE * 1.06, BLADE_SIZE * 1.06)
      .setDepth(12)
      .setAlpha(0.28)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD);

    const highlight = this.scene.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE * 0.82, BLADE_SIZE * 0.82)
      .setDepth(14)
      .setAlpha(0.2)
      .setTintFill(color)
      .setBlendMode(Phaser.BlendModes.SCREEN);

    if (actor === "ai") {
      base.rotation = Math.PI;
      ring.rotation = Math.PI;
      highlight.rotation = Math.PI;
    }

    return { shadow, glow, base, ring, highlight, trailNextAt: 0 };
  }

  private setActorBlade(actor: ActorId, bladeId: BeybladeId): void {
    const color = this.resolveBladeColor(bladeId);
    const visual = this.visuals[actor];
    const key = this.textureKey(bladeId);

    visual.base?.setTexture(key);
    visual.ring?.setTexture(key).setTint(color);
    visual.highlight?.setTexture(key).setTintFill(color);
    visual.glow?.setFillStyle(color, 0.14).setStrokeStyle(3, color, 0.9);
  }

  private updateActorVisual(
    actor: ActorId,
    time: number,
    delta: number,
    hpRatioRaw: number
  ): void {
    const visual = this.visuals[actor];
    const state = this.motion[actor];
    const hpRatio = clamp(hpRatioRaw, 0.1, 1);

    state.pushOffsetX *= 0.82;
    if (Math.abs(state.pushOffsetX) < 0.1) {
      state.pushOffsetX = 0;
    }

    const orbitX = Math.sin(time / 230 + state.phase) * ORBIT_X;
    const orbitY = Math.cos(time / 290 + state.phase) * ORBIT_Y;

    const x = clamp(
      state.homeX +
        orbitX +
        state.attackOffsetX +
        state.dodgeOffsetX +
        state.pushOffsetX,
      actor === "player" ? 70 : 220,
      actor === "player" ? 580 : 730
    );
    const y = state.homeY + orbitY + state.attackOffsetY + state.dodgeOffsetY;

    const hpPenalty = 1 - hpRatio;
    const boost = time < state.spinBoostUntil ? 1.48 : 1;
    const spinFactor = (1 + hpPenalty * 0.32) * boost;
    const spinDelta = Phaser.Math.DegToRad(state.spinDegPerSec * spinFactor) * (delta / 1000);
    const wobble = Math.sin(time / 92 + state.phase * 3) * (0.04 + hpPenalty * 0.05);

    visual.shadow?.setPosition(x, y + BLADE_SIZE * 0.32).setScale(
      1 + Math.abs(state.attackOffsetX) / 560,
      1
    );

    visual.glow?.setPosition(x, y).setRotation((time / 1200) * (actor === "player" ? 1 : -1));

    if (visual.base && visual.ring && visual.highlight) {
      visual.base.setPosition(x, y);
      visual.ring.setPosition(x, y);
      visual.highlight.setPosition(x, y);

      visual.base.rotation += spinDelta;
      visual.ring.rotation += spinDelta * 1.55;
      visual.highlight.rotation -= spinDelta * 0.72;

      visual.base.setScale(1 + wobble * 0.18, 1 - wobble * 0.14);
      visual.ring.setScale(1.05 + wobble * 0.22, 1.05 - wobble * 0.18);
      visual.highlight.setScale(0.82 + wobble * 0.15, 0.82 - wobble * 0.1);

      const trailInterval = boost > 1 ? 28 : Math.max(36, 52 - hpPenalty * 14);
      if (time >= visual.trailNextAt) {
        this.spawnTrail(
          actor,
          x,
          y,
          visual.base.rotation,
          boost,
          this.resolveBladeColor(this.actorBlade[actor])
        );
        visual.trailNextAt = time + trailInterval;
      }
    }
  }

  private spawnTrail(
    actor: ActorId,
    x: number,
    y: number,
    rotation: number,
    boost: number,
    fallbackColor: number
  ): void {
    const blade = this.visuals[actor].base;
    if (!blade) {
      return;
    }

    const trail = this.scene.add
      .image(x, y, blade.texture.key)
      .setDisplaySize(BLADE_SIZE * 0.88, BLADE_SIZE * 0.88)
      .setDepth(11)
      .setRotation(rotation)
      .setAlpha(boost > 1 ? 0.22 : 0.12)
      .setTint(fallbackColor)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      scaleX: trail.scaleX + 0.16,
      scaleY: trail.scaleY + 0.16,
      duration: boost > 1 ? 160 : 200,
      ease: "Sine.Out",
      onComplete: () => {
        trail.destroy();
      }
    });
  }

  private animateCurve(
    curve: Phaser.Curves.CubicBezier,
    duration: number,
    ease: string,
    onPoint: (point: Phaser.Math.Vector2) => void,
    onComplete?: () => void
  ): void {
    const cursor = { t: 0 };
    this.scene.tweens.add({
      targets: cursor,
      t: 1,
      duration,
      ease,
      onUpdate: () => {
        const p = curve.getPoint(cursor.t);
        onPoint(p);
      },
      onComplete: () => {
        onComplete?.();
      }
    });
  }

  private emitImpactSparks(
    x: number,
    y: number,
    color: number,
    count: number
  ): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(22, 56);
      const spark = this.scene.add
        .rectangle(x, y, Phaser.Math.Between(8, 16), 3, color, 0.95)
        .setDepth(20)
        .setRotation(angle);

      this.scene.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.1,
        duration: Phaser.Math.Between(140, 220),
        ease: "Cubic.Out",
        onComplete: () => {
          spark.destroy();
        }
      });
    }
  }

  private applyHitStop(durationMs: number): void {
    const now = this.scene.time.now;
    const until = now + durationMs;
    if (until <= this.hitStopUntil) {
      return;
    }

    this.hitStopUntil = until;
    if (!this.tweensPausedByHitStop) {
      this.tweensPausedByHitStop = true;
      this.scene.tweens.pauseAll();
    }

    this.scene.time.delayedCall(durationMs, () => {
      if (this.scene.time.now < this.hitStopUntil - 1) {
        return;
      }

      if (this.tweensPausedByHitStop) {
        this.tweensPausedByHitStop = false;
        this.scene.tweens.resumeAll();
      }
    });
  }
}

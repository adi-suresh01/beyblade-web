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
      spinDegPerSec: 1480,
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
    spinDegPerSec: -1420,
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
    console.log('BLADE_SIZE:', BLADE_SIZE);
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

    this.updateFloatingBar(this.visuals.player, hpRatios.player, false);
    this.updateFloatingBar(this.visuals.ai, hpRatios.ai, false);

    const playerBase = this.visuals.player.base;
    const aiBase = this.visuals.ai.base;

    if (playerBase && aiBase) {
      const dx = playerBase.x - aiBase.x;
      const dy = playerBase.y - aiBase.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < BLADE_SIZE * 1.5 && time % 180 < delta) {
        const midX = (playerBase.x + aiBase.x) / 2;
        const midY = (playerBase.y + aiBase.y) / 2;
        this.spawnClashSpark(midX, midY);
      }
    }
  }

  updateFloatingBar(visual: ActorVisual, ratio: number, isBit: boolean): void {
    const bar = isBit ? visual.bitBar : visual.hpBar;
    const base = visual.base;
    if (!bar || !base) return;

    bar.setPosition(base.x, base.y - 22);
    const fill = bar.list[1] as Phaser.GameObjects.Rectangle;
    fill.width = 32 * ratio;

    if (!isBit && ratio < 0.3) {
      fill.setFillStyle(0xff5a7a, 0.95);
    }
  }

  updateBitBars(playerBit: number, aiBit: number): void {
    this.updateFloatingBar(this.visuals.player, playerBit / 100, true);
    this.updateFloatingBar(this.visuals.ai, aiBit / 100, true);

    const playerBitBar = this.visuals.player.bitBar;
    const aiBitBar = this.visuals.ai.bitBar;
    if (playerBitBar) playerBitBar.setY(playerBitBar.y - 6);
    if (aiBitBar) aiBitBar.setY(aiBitBar.y - 6);
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
    const blade = visual.base;

    this.scene.tweens.killTweensOf(state);
    state.attackOffsetX = 0;
    state.attackOffsetY = 0;
    state.spinBoostUntil = this.scene.time.now + 560;

    const color = this.resolveBladeColor(this.actorBlade[actor]);

    this.scene.tweens.add({
      targets: state,
      attackOffsetX: -direction * 28,
      attackOffsetY: arcY * 0.16,
      duration: 68,
      ease: "Quad.In",
      onComplete: () => {
        const start = new Phaser.Math.Vector2(state.attackOffsetX, state.attackOffsetY);
        const curve = new Phaser.Curves.CubicBezier(
          start,
          new Phaser.Math.Vector2(direction * 128, arcY * 1.1),
          new Phaser.Math.Vector2(direction * 260, arcY * 0.38),
          new Phaser.Math.Vector2(direction * ATTACK_LUNGE_DISTANCE, 0)
        );

        if (blade) {
          for (let i = 0; i < 5; i++) {
            this.scene.time.delayedCall(i * 20, () => {
              const slash = this.scene.add
                .rectangle(
                  blade.x + direction * i * 15,
                  blade.y,
                  24,
                  4,
                  color,
                  0.6
                )
                .setDepth(12)
                .setRotation(direction * 0.3)
                .setBlendMode(Phaser.BlendModes.ADD);

              this.scene.tweens.add({
                targets: slash,
                alpha: 0,
                scaleX: 2,
                duration: 140,
                ease: "Quad.Out",
                onComplete: () => {
                  slash.destroy();
                }
              });
            });
          }
        }

        this.animateCurve(curve, ATTACK_LUNGE_IN_MS, "Cubic.Out", (p) => {
          state.attackOffsetX = p.x;
          state.attackOffsetY = p.y;
        }, () => {
          this.scene.time.delayedCall(ATTACK_LUNGE_HOLD_MS, () => {
            this.scene.tweens.add({
              targets: state,
              attackOffsetX: 0,
              attackOffsetY: 0,
              duration: 200,
              ease: "Back.InOut"
            });
          });
        });
      }
    });

    if (visual.glow) {
      this.scene.tweens.add({
        targets: visual.glow,
        alpha: 0.42,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 100,
        yoyo: true,
        ease: "Quad.Out"
      });
    }

    if (visual.base) {
      this.scene.tweens.add({
        targets: visual.base,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 80,
        yoyo: true,
        ease: "Back.Out"
      });
    }
  }

  playDodgeAnimation(actor: ActorId): void {
    const state = this.motion[actor];
    const visual = this.visuals[actor];
    const escapeX = actor === "player" ? -DODGE_ESCAPE_X : DODGE_ESCAPE_X;
    const escapeY = actor === "player" ? -DODGE_ESCAPE_Y : DODGE_ESCAPE_Y;
    const blade = visual.base;
    const color = this.resolveBladeColor(this.actorBlade[actor]);

    this.scene.tweens.killTweensOf(state);
    state.dodgeOffsetX = 0;
    state.dodgeOffsetY = 0;
    state.spinBoostUntil = this.scene.time.now + 340;

    if (blade) {
      const afterImage1 = this.scene.add
        .image(blade.x, blade.y, blade.texture.key)
        .setDisplaySize(BLADE_SIZE, BLADE_SIZE)
        .setDepth(11)
        .setRotation(blade.rotation)
        .setAlpha(0.4)
        .setTint(color)
        .setBlendMode(Phaser.BlendModes.ADD);

      this.scene.tweens.add({
        targets: afterImage1,
        alpha: 0,
        scaleX: 1.2,
        scaleY: 1.2,
        duration: 180,
        ease: "Quad.Out",
        onComplete: () => {
          afterImage1.destroy();
        }
      });
    }

    this.scene.tweens.add({
      targets: state,
      dodgeOffsetX: -escapeX * 0.28,
      dodgeOffsetY: escapeY * 0.18,
      duration: 50,
      ease: "Quad.In",
      onComplete: () => {
        if (blade) {
          const afterImage2 = this.scene.add
            .image(blade.x, blade.y, blade.texture.key)
            .setDisplaySize(BLADE_SIZE, BLADE_SIZE)
            .setDepth(11)
            .setRotation(blade.rotation)
            .setAlpha(0.35)
            .setTint(color)
            .setBlendMode(Phaser.BlendModes.ADD);

          this.scene.tweens.add({
            targets: afterImage2,
            alpha: 0,
            scaleX: 1.15,
            scaleY: 1.15,
            duration: 160,
            ease: "Sine.Out",
            onComplete: () => {
              afterImage2.destroy();
            }
          });
        }

        const curve = new Phaser.Curves.CubicBezier(
          new Phaser.Math.Vector2(state.dodgeOffsetX, state.dodgeOffsetY),
          new Phaser.Math.Vector2(escapeX * 0.42, escapeY * 0.3),
          new Phaser.Math.Vector2(escapeX * 0.86, escapeY * 1.06),
          new Phaser.Math.Vector2(escapeX, escapeY * 0.9)
        );

        this.animateCurve(curve, 130, "Sine.Out", (p) => {
          state.dodgeOffsetX = p.x;
          state.dodgeOffsetY = p.y;
        }, () => {
          this.scene.time.delayedCall(45, () => {
            this.scene.tweens.add({
              targets: state,
              dodgeOffsetX: 0,
              dodgeOffsetY: 0,
              duration: 160,
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
        alpha: 0.38,
        duration: 80,
        yoyo: true,
        repeat: 2,
        ease: "Sine.InOut",
        onComplete: () => {
          visual.base?.setAlpha(1);
        }
      });
    }

    if (visual.ring) {
      this.scene.tweens.add({
        targets: visual.ring,
        alpha: 0.5,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 100,
        yoyo: true,
        ease: "Quad.Out"
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
    this.motion[actor].spinBoostUntil = now + 920;

    for (let i = 0; i < 3; i++) {
      const delay = i * 80;
      this.scene.time.delayedCall(delay, () => {
        const chargeRing = this.scene.add
          .circle(token.x, token.y, BLADE_SIZE * 0.52, color, 0.24)
          .setDepth(15)
          .setStrokeStyle(3 - i, color, 0.85);

        this.scene.tweens.add({
          targets: chargeRing,
          scaleX: 2.4 + i * 0.4,
          scaleY: 2.4 + i * 0.4,
          alpha: 0,
          duration: 380 + i * 60,
          ease: "Quad.Out",
          onComplete: () => {
            chargeRing.destroy();
          }
        });
      });
    }

    const pillar = this.scene.add
      .rectangle(token.x, token.y, BLADE_SIZE * 2, BLADE_SIZE * 3, color, 0.4)
      .setDepth(14)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: pillar,
      scaleY: 2.5,
      alpha: 0,
      duration: 460,
      ease: "Cubic.Out",
      onComplete: () => {
        pillar.destroy();
      }
    });

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const distance = 60;
      const orbX = token.x + Math.cos(angle) * distance;
      const orbY = token.y + Math.sin(angle) * distance;

      const orb = this.scene.add
        .circle(orbX, orbY, 5, color, 0.9)
        .setDepth(16)
        .setBlendMode(Phaser.BlendModes.ADD);

      this.scene.tweens.add({
        targets: orb,
        x: token.x,
        y: token.y,
        scale: 0.2,
        alpha: 0,
        duration: 280,
        ease: "Quad.In",
        onComplete: () => {
          orb.destroy();
        }
      });
    }

    const aura = this.scene.add
      .circle(token.x, token.y, 24, color, 0.42)
      .setDepth(16)
      .setStrokeStyle(2, 0xffffff, 0.75)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: aura,
      scaleX: 10.5,
      scaleY: 10.5,
      alpha: 0,
      duration: 620,
      ease: "Cubic.Out",
      onComplete: () => {
        aura.destroy();
      }
    });

    const flash = this.scene.add
      .rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, 800, 400, 0xffffff, 0.3)
      .setDepth(25)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 140,
      ease: "Quad.Out",
      onComplete: () => {
        flash.destroy();
      }
    });

    this.scene.cameras.main.shake(140, 0.006);
  }

  showImpactEffect(target: ActorId, damage: number, bitBeast: boolean): void {
    const token = this.visuals[target].base;
    if (!token) {
      return;
    }

    const flashColor = target === "player" ? 0xff5d7f : 0x4fd48c;
    const burstScale = bitBeast ? 5.2 : 3.8;
    const pushDirection = target === "player" ? -1 : 1;
    const pushAmount = bitBeast ? 96 : 68;
    const state = this.motion[target];

    state.pushOffsetX = pushDirection * pushAmount;
    state.spinBoostUntil = this.scene.time.now + (bitBeast ? 680 : 420);

    const impactRing = this.scene.add
      .circle(token.x, token.y, 8, 0xffffff, 0.9)
      .setDepth(17);

    this.scene.tweens.add({
      targets: impactRing,
      scaleX: bitBeast ? 3.2 : 2.4,
      scaleY: bitBeast ? 3.2 : 2.4,
      alpha: 0,
      duration: bitBeast ? 220 : 140,
      ease: "Quad.Out",
      onComplete: () => {
        impactRing.destroy();
      }
    });

    const burst = this.scene.add
      .circle(token.x, token.y, 12, flashColor, 0.85)
      .setDepth(18);

    const outerBurst = this.scene.add
      .circle(token.x, token.y, 18, flashColor, 0.5)
      .setDepth(17)
      .setBlendMode(Phaser.BlendModes.ADD);

    const damageText = this.scene.add
      .text(token.x, token.y - 38, `-${damage}`, {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: bitBeast ? "36px" : "28px",
        fontStyle: "700",
        color: "#ffffff",
        stroke: "#0b1730",
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(19);

    this.emitImpactSparks(token.x, token.y, flashColor, bitBeast ? 16 : 12);
    this.emitShockwave(token.x, token.y, flashColor, bitBeast);

    this.scene.tweens.add({
      targets: burst,
      scaleX: burstScale,
      scaleY: burstScale,
      alpha: 0,
      duration: bitBeast ? 480 : 340,
      ease: "Cubic.Out",
      onComplete: () => {
        burst.destroy();
      }
    });

    this.scene.tweens.add({
      targets: outerBurst,
      scaleX: burstScale * 1.4,
      scaleY: burstScale * 1.4,
      alpha: 0,
      duration: bitBeast ? 520 : 380,
      ease: "Sine.Out",
      onComplete: () => {
        outerBurst.destroy();
      }
    });

    this.scene.tweens.add({
      targets: damageText,
      y: damageText.y - 40,
      alpha: 0,
      scale: 1.2,
      duration: bitBeast ? 720 : 520,
      ease: "Back.Out",
      onComplete: () => {
        damageText.destroy();
      }
    });

    this.applyHitStop(bitBeast ? BIT_BEAST_HIT_STOP_MS : IMPACT_HIT_STOP_MS);
    this.scene.cameras.main.shake(bitBeast ? 160 : 100, bitBeast ? 0.008 : 0.004);
  }

  showMissEffect(target: ActorId): void {
    const token = this.visuals[target].base;
    if (!token) {
      return;
    }

    const swoosh = this.scene.add
      .ellipse(token.x, token.y, 60, 20, 0xffffff, 0.4)
      .setDepth(16)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: swoosh,
      scaleX: 2,
      alpha: 0,
      duration: 180,
      ease: "Quad.Out",
      onComplete: () => {
        swoosh.destroy();
      }
    });

    const missText = this.scene.add
      .text(token.x, token.y - 36, "MISS", {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: "26px",
        fontStyle: "700",
        color: "#ffe16c",
        stroke: "#12203f",
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(18);

    this.scene.tweens.add({
      targets: missText,
      y: missText.y - 24,
      alpha: 0,
      scale: 1.15,
      duration: 420,
      ease: "Back.Out",
      onComplete: () => {
        missText.destroy();
      }
    });

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const x = token.x + Math.cos(angle) * 30;
      const y = token.y + Math.sin(angle) * 30;

      const particle = this.scene.add
        .circle(x, y, 3, 0xffe16c, 0.7)
        .setDepth(17);

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * 20,
        y: y + Math.sin(angle) * 20,
        alpha: 0,
        duration: 240,
        ease: "Quad.Out",
        onComplete: () => {
          particle.destroy();
        }
      });
    }
  }

  private drawArenaBackdrop(): void {
    const graphics = this.scene.add.graphics();

    graphics.fillStyle(0x050d1f, 1);
    graphics.fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);

    const gradient = this.scene.add.graphics();
    gradient.fillGradientStyle(0x0a1836, 0x0a1836, 0x1a2d5a, 0x1a2d5a, 0.85, 0.85, 0.4, 0.4);
    gradient.fillRect(ARENA_CENTER_X - 380, ARENA_CENTER_Y - 180, 760, 360);
    gradient.setBlendMode(Phaser.BlendModes.ADD);

    this.scene.add
      .rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, 760, 360, 0x081630, 0.2)
      .setStrokeStyle(4, 0x294c87, 0.95);

    for (let i = 0; i < 3; i++) {
      const radius = 200 - i * 34;
      const circle = this.scene.add
        .circle(ARENA_CENTER_X, ARENA_CENTER_Y, radius, 0x0a1836, 0.08)
        .setStrokeStyle(2, 0x3d70c4, 0.4 + i * 0.15);

      this.scene.tweens.add({
        targets: circle,
        alpha: 0.3 + i * 0.1,
        duration: 1200 + i * 400,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut"
      });
    }

    for (let i = 0; i < 6; i++) {
      const angle = (i * 60) * Math.PI / 180;
      const x = ARENA_CENTER_X + Math.cos(angle) * 170;
      const y = ARENA_CENTER_Y + Math.sin(angle) * 170;
      const marker = this.scene.add
        .circle(x, y, 3, 0x4f89e8, 0.6)
        .setDepth(1);

      this.scene.tweens.add({
        targets: marker,
        alpha: 0.8,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 1600 + i * 200,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut"
      });
    }

    const centerGlow = this.scene.add
      .circle(ARENA_CENTER_X, ARENA_CENTER_Y, 8, 0x4f89e8, 0.3)
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: centerGlow,
      scaleX: 2.5,
      scaleY: 2.5,
      alpha: 0.5,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut"
    });
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
    visual.hpBar?.destroy(true);
    visual.bitBar?.destroy(true);
    this.visuals[actor] = emptyVisual();
  }

  private createActorVisual(actor: ActorId, bladeId: BeybladeId): ActorVisual {
    const color = this.resolveBladeColor(bladeId);

    const shadow = this.scene.add
      .ellipse(0, 0, BLADE_SIZE * 0.92, BLADE_SIZE * 0.26, 0x000000, 0.42)
      .setDepth(9);

    const outerGlow = this.scene.add
      .circle(0, 0, BLADE_SIZE * 0.72, color, 0.08)
      .setDepth(9)
      .setBlendMode(Phaser.BlendModes.ADD);

    const glow = this.scene.add
      .ellipse(0, 0, BLADE_SIZE * 1.28, BLADE_SIZE * 1.28, color, 0.16)
      .setStrokeStyle(3, color, 0.95)
      .setDepth(10)
      .setBlendMode(Phaser.BlendModes.ADD);

    const innerGlow = this.scene.add
      .circle(0, 0, BLADE_SIZE * 0.48, color, 0.12)
      .setDepth(11)
      .setBlendMode(Phaser.BlendModes.ADD);

    const base = this.scene.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE, BLADE_SIZE)
      .setDepth(13);

    const ring = this.scene.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE * 1.08, BLADE_SIZE * 1.08)
      .setDepth(12)
      .setAlpha(0.32)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD);

    const highlight = this.scene.add
      .image(0, 0, this.textureKey(bladeId))
      .setDisplaySize(BLADE_SIZE * 0.84, BLADE_SIZE * 0.84)
      .setDepth(14)
      .setAlpha(0.24)
      .setTintFill(color)
      .setBlendMode(Phaser.BlendModes.SCREEN);

    if (actor === "ai") {
      base.rotation = Math.PI;
      ring.rotation = Math.PI;
      highlight.rotation = Math.PI;
    }

    this.scene.tweens.add({
      targets: outerGlow,
      scaleX: 1.15,
      scaleY: 1.15,
      alpha: 0.12,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut"
    });

    this.scene.tweens.add({
      targets: innerGlow,
      rotation: Math.PI * 2,
      duration: 2400,
      repeat: -1,
      ease: "Linear"
    });

    const hpBar = this.createFloatingBar(color);
    const bitBar = this.createFloatingBar(0xffd84d);

    return { shadow, glow, base, ring, highlight, trailNextAt: 0, hpBar, bitBar };
  }

  private createFloatingBar(color: number): Phaser.GameObjects.Container {
    const bg = this.scene.add
      .rectangle(0, 0, 32, 4, 0x0a1836, 0.8)
      .setStrokeStyle(1, 0x3d70c4, 0.6);

    const fill = this.scene.add
      .rectangle(-16, 0, 0, 4, color, 0.95)
      .setOrigin(0, 0.5);

    const container = this.scene.add
      .container(0, -22, [bg, fill])
      .setDepth(20);

    return container;
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

    state.pushOffsetX *= 0.84;
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
    const boost = time < state.spinBoostUntil ? 1.56 : 1;
    const spinFactor = (1 + hpPenalty * 0.36) * boost;
    const spinDelta = Phaser.Math.DegToRad(state.spinDegPerSec * spinFactor) * (delta / 1000);
    const wobble = Math.sin(time / 92 + state.phase * 3) * (0.05 + hpPenalty * 0.06);

    const shadowScale = 1 + Math.abs(state.attackOffsetX) / 520 + hpPenalty * 0.15;
    visual.shadow?.setPosition(x, y + BLADE_SIZE * 0.34).setScale(shadowScale, 1);

    const glowPulse = 1 + Math.sin(time / 300) * 0.08;
    visual.glow
      ?.setPosition(x, y)
      .setRotation((time / 1200) * (actor === "player" ? 1 : -1))
      .setScale(glowPulse * (boost > 1 ? 1.15 : 1));

    if (visual.base && visual.ring && visual.highlight) {
      const baseScale = BLADE_SIZE / visual.base.width;
      const ringScale = (BLADE_SIZE * 1.08) / visual.ring.width;
      const highlightScale = (BLADE_SIZE * 0.84) / visual.highlight.width;

      visual.base.setPosition(x, y);
      visual.ring.setPosition(x, y);
      visual.highlight.setPosition(x, y);

      visual.base.rotation += spinDelta;
      visual.ring.rotation += spinDelta * 1.62;
      visual.highlight.rotation -= spinDelta * 0.78;

      const scaleBoost = boost > 1 ? 1.06 : 1;
      visual.base.setScale(
        baseScale * (1 + wobble * 0.2) * scaleBoost,
        baseScale * (1 - wobble * 0.16) * scaleBoost
      );
      visual.ring.setScale(
        ringScale * (1.05 + wobble * 0.24) * scaleBoost,
        ringScale * (1.05 - wobble * 0.2) * scaleBoost
      );
      visual.highlight.setScale(
        highlightScale * (0.82 + wobble * 0.18) * scaleBoost,
        highlightScale * (0.82 - wobble * 0.12) * scaleBoost
      );

      const trailInterval = boost > 1 ? 24 : Math.max(32, 48 - hpPenalty * 16);
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
      .setAlpha(boost > 1 ? 0.28 : 0.15)
      .setTint(fallbackColor)
      .setBlendMode(Phaser.BlendModes.ADD);

    const glow = this.scene.add
      .circle(x, y, BLADE_SIZE * 0.4, fallbackColor, boost > 1 ? 0.18 : 0.08)
      .setDepth(10)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      scaleX: trail.scaleX + 0.2,
      scaleY: trail.scaleY + 0.2,
      duration: boost > 1 ? 180 : 240,
      ease: "Cubic.Out",
      onComplete: () => {
        trail.destroy();
      }
    });

    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: boost > 1 ? 200 : 260,
      ease: "Sine.Out",
      onComplete: () => {
        glow.destroy();
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
      const distance = Phaser.Math.Between(28, 72);
      const sparkLength = Phaser.Math.Between(10, 20);
      const spark = this.scene.add
        .rectangle(x, y, sparkLength, 4, color, 0.98)
        .setDepth(20)
        .setRotation(angle);

      const glowSpark = this.scene.add
        .rectangle(x, y, sparkLength * 0.6, 2, 0xffffff, 0.8)
        .setDepth(21)
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD);

      this.scene.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.5,
        duration: Phaser.Math.Between(180, 280),
        ease: "Cubic.Out",
        onComplete: () => {
          spark.destroy();
        }
      });

      this.scene.tweens.add({
        targets: glowSpark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.1,
        duration: Phaser.Math.Between(160, 240),
        ease: "Quad.Out",
        onComplete: () => {
          glowSpark.destroy();
        }
      });
    }
  }

  private emitShockwave(x: number, y: number, color: number, intense: boolean): void {
    const wave = this.scene.add
      .circle(x, y, 12, color, 0)
      .setDepth(16)
      .setStrokeStyle(intense ? 4 : 3, color, 0.8);

    this.scene.tweens.add({
      targets: wave,
      scaleX: intense ? 6.5 : 4.5,
      scaleY: intense ? 6.5 : 4.5,
      alpha: 0,
      duration: intense ? 420 : 320,
      ease: "Sine.Out",
      onComplete: () => {
        wave.destroy();
      }
    });

    if (intense) {
      const wave2 = this.scene.add
        .circle(x, y, 12, color, 0)
        .setDepth(16)
        .setStrokeStyle(2, 0xffffff, 0.6);

      this.scene.tweens.add({
        targets: wave2,
        scaleX: 8,
        scaleY: 8,
        alpha: 0,
        duration: 540,
        ease: "Cubic.Out",
        onComplete: () => {
          wave2.destroy();
        }
      });
    }
  }

  private spawnClashSpark(x: number, y: number): void {
    const colors = [0xffd84d, 0xff8753, 0x4bc3ff, 0xffffff];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const spark = this.scene.add
      .circle(x, y, 3, color, 0.85)
      .setDepth(17)
      .setBlendMode(Phaser.BlendModes.ADD);

    const angle = Math.random() * Math.PI * 2;
    const distance = Phaser.Math.Between(12, 28);

    this.scene.tweens.add({
      targets: spark,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      alpha: 0,
      scaleX: 0.3,
      scaleY: 0.3,
      duration: Phaser.Math.Between(120, 200),
      ease: "Quad.Out",
      onComplete: () => {
        spark.destroy();
      }
    });
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

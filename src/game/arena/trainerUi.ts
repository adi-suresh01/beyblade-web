import Phaser from "phaser";
import { BEYBLADES } from "@/lib/game/beyblades";
import { ArenaConfig, BeybladeId } from "@/lib/game/types";
import { ActorId, SpeechBubble } from "@/game/arena/types";

type ResolveColor = (bladeId: BeybladeId) => number;

export class ArenaTrainerUi {
  private readonly scene: Phaser.Scene;
  private readonly resolveBladeColor: ResolveColor;

  private playerTrainer?: Phaser.GameObjects.Container;
  private aiTrainer?: Phaser.GameObjects.Container;

  private playerBubble?: SpeechBubble;
  private aiBubble?: SpeechBubble;
  private playerBubbleTimer?: Phaser.Time.TimerEvent;
  private aiBubbleTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, resolveBladeColor: ResolveColor) {
    this.scene = scene;
    this.resolveBladeColor = resolveBladeColor;
  }

  render(config: ArenaConfig): void {
    this.playerTrainer?.destroy(true);
    this.aiTrainer?.destroy(true);
    this.playerBubble?.container.destroy(true);
    this.aiBubble?.container.destroy(true);

    this.playerTrainer = this.createTrainerModel(
      122,
      308,
      "YOU",
      this.resolveBladeColor(config.playerBlade),
      "right"
    );
    this.aiTrainer = this.createTrainerModel(
      678,
      308,
      "AI",
      this.resolveBladeColor(config.aiBlade),
      "left"
    );

    this.playerBubble = this.createTrashBubble(182, 92, "left");
    this.aiBubble = this.createTrashBubble(618, 92, "right");
  }

  destroy(): void {
    this.playerBubbleTimer?.remove(false);
    this.aiBubbleTimer?.remove(false);
    this.playerTrainer?.destroy(true);
    this.aiTrainer?.destroy(true);
    this.playerBubble?.container.destroy(true);
    this.aiBubble?.container.destroy(true);
  }

  showTrashBubble(speaker: ActorId, content: string): void {
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

    this.scene.tweens.killTweensOf(bubble.container);
    bubble.container.setVisible(true).setAlpha(0).setScale(0.9);
    this.scene.tweens.add({
      targets: bubble.container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 170,
      ease: "Back.Out"
    });

    if (speaker === "player") {
      this.playerBubbleTimer?.remove(false);
      this.playerBubbleTimer = this.scene.time.delayedCall(2600, () => {
        this.hideBubble(this.playerBubble);
      });
      return;
    }

    this.aiBubbleTimer?.remove(false);
    this.aiBubbleTimer = this.scene.time.delayedCall(2600, () => {
      this.hideBubble(this.aiBubble);
    });
  }

  hideAllBubbles(): void {
    this.hideBubble(this.playerBubble);
    this.hideBubble(this.aiBubble);
  }

  private hideBubble(bubble?: SpeechBubble): void {
    if (!bubble) {
      return;
    }

    this.scene.tweens.killTweensOf(bubble.container);
    this.scene.tweens.add({
      targets: bubble.container,
      alpha: 0,
      duration: 170,
      ease: "Sine.In",
      onComplete: () => {
        bubble.container.setVisible(false);
      }
    });
  }

  private createTrainerModel(
    x: number,
    y: number,
    label: string,
    jacketColor: number,
    facing: "left" | "right"
  ): Phaser.GameObjects.Container {
    const hair = this.scene.add
      .ellipse(0, -49, 24, 16, 0x1e2b53, 1)
      .setStrokeStyle(1, 0x111a35, 0.95);

    const head = this.scene.add
      .circle(0, -42, 12, 0xf8dbc3, 1)
      .setStrokeStyle(2, 0x1c2748, 0.95);

    const torso = this.scene.add
      .rectangle(0, -12, 26, 40, jacketColor, 1)
      .setStrokeStyle(2, 0x1a2646, 0.95);

    const belt = this.scene.add.rectangle(0, 2, 24, 5, 0xe8eefc, 0.92);
    const legLeft = this.scene.add.rectangle(-8, 18, 9, 20, 0x1a2c57, 1);
    const legRight = this.scene.add.rectangle(8, 18, 9, 20, 0x1a2c57, 1);

    const launcherOffset = facing === "right" ? 21 : -21;
    const launcher = this.scene.add
      .rectangle(launcherOffset, -14, 22, 10, 0xe6eefc, 1)
      .setStrokeStyle(1, 0x1c2748, 0.9);

    const cord = this.scene.add
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

    const title = this.scene.add
      .text(0, -68, label, {
        fontFamily: "Teko, Rajdhani, sans-serif",
        fontSize: "15px",
        fontStyle: "700",
        color: "#f1f6ff",
        stroke: "#0c1834",
        strokeThickness: 4
      })
      .setOrigin(0.5);

    const bladeName = this.scene.add
      .text(0, 34, label === "YOU" ? BEYBLADES.dragoon.name : BEYBLADES.dranzer.name, {
        fontFamily: "Rajdhani, sans-serif",
        fontSize: "12px",
        color: "#d8e7ff"
      })
      .setOrigin(0.5);

    return this.scene.add
      .container(x, y, [
        hair,
        head,
        torso,
        belt,
        legLeft,
        legRight,
        launcher,
        cord,
        title,
        bladeName
      ])
      .setDepth(8);
  }

  private createTrashBubble(
    x: number,
    y: number,
    side: "left" | "right"
  ): SpeechBubble {
    const bubbleBg = this.scene.add
      .rectangle(0, 0, 258, 74, 0x102247, 0.96)
      .setStrokeStyle(2, 0xe8f2ff, 0.38);

    const tailX = side === "left" ? -80 : 80;
    const tail = this.scene.add
      .triangle(tailX, 33, 0, 0, 14, 0, 7, 15, 0x102247, 0.96)
      .setStrokeStyle(2, 0xe8f2ff, 0.38);

    const text = this.scene.add
      .text(0, -2, "", {
        fontFamily: "Rajdhani, Sora, sans-serif",
        fontSize: "14px",
        color: "#f7fbff",
        align: "center",
        wordWrap: { width: 226, useAdvancedWrap: true }
      })
      .setOrigin(0.5);

    const container = this.scene.add
      .container(x, y, [bubbleBg, tail, text])
      .setDepth(24)
      .setVisible(false)
      .setAlpha(0);

    return { container, text };
  }
}

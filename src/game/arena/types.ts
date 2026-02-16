import Phaser from "phaser";

export type ActorId = "player" | "ai";

export interface SpeechBubble {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
}

export interface ActorVisual {
  shadow?: Phaser.GameObjects.Ellipse;
  glow?: Phaser.GameObjects.Ellipse;
  base?: Phaser.GameObjects.Image;
  ring?: Phaser.GameObjects.Image;
  highlight?: Phaser.GameObjects.Image;
  trailNextAt: number;
}

export interface ActorMotion {
  homeX: number;
  homeY: number;
  phase: number;
  spinDegPerSec: number;
  attackOffsetX: number;
  attackOffsetY: number;
  dodgeOffsetX: number;
  dodgeOffsetY: number;
  pushOffsetX: number;
  spinBoostUntil: number;
}

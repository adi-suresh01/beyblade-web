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
  subscribeArenaReset
} from "@/lib/game/arenaBus";
import {
  DEFAULT_ARENA_CONFIG,
  MAX_BIT,
  MAX_HP
} from "@/lib/game/constants";
import { ArenaConfig, GameCommand } from "@/lib/game/types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export class BeybladeArenaScene extends Phaser.Scene {
  private config: ArenaConfig = DEFAULT_ARENA_CONFIG;

  private playerToken?: Phaser.GameObjects.Arc;
  private aiToken?: Phaser.GameObjects.Arc;

  private playerHp = MAX_HP;
  private aiHp = MAX_HP;
  private playerBit = 0;
  private aiBit = 0;
  private winner: "player" | "ai" | null = null;

  private playerLockedUntil = 0;
  private aiLockedUntil = 0;
  private playerDodgingUntil = 0;
  private aiDodgingUntil = 0;

  private aiThinkClock = 0;

  private offCommand?: () => void;
  private offConfig?: () => void;
  private offReset?: () => void;

  constructor() {
    super("arena");
  }

  create(): void {
    this.config = getArenaConfig();

    this.add.rectangle(400, 210, 760, 360, 0x0a1630, 0.9).setStrokeStyle(3, 0x264071, 0.85);
    this.add.circle(400, 210, 140, 0x13295a, 0.5).setStrokeStyle(2, 0x2a4f8f, 0.7);

    this.playerToken = this.add.circle(220, 210, 24, Phaser.Display.Color.HexStringToColor(BEYBLADES[this.config.playerBlade].color).color, 1);
    this.aiToken = this.add.circle(580, 210, 24, Phaser.Display.Color.HexStringToColor(BEYBLADES[this.config.aiBlade].color).color, 1);

    this.attachListeners();
    this.broadcastState();
    this.emitSystem(`Arena online. ${BEYBLADES[this.config.playerBlade].name} vs ${BEYBLADES[this.config.aiBlade].name}.`);
  }

  update(time: number, delta: number): void {
    if (!this.playerToken || !this.aiToken) {
      return;
    }

    this.animateTokens(delta);

    if (this.winner) {
      return;
    }

    this.aiThinkClock += delta;
    if (this.aiThinkClock >= aiActionDelay(this.config.difficulty)) {
      this.aiThinkClock = 0;
      this.performAiAction(time);
    }
  }

  private animateTokens(deltaMs: number): void {
    if (!this.playerToken || !this.aiToken) {
      return;
    }

    const t = this.time.now / 650;
    const orbit = 30;

    this.playerToken.x = 220 + Math.sin(t * 1.8) * orbit;
    this.playerToken.y = 210 + Math.cos(t * 1.2) * orbit;

    this.aiToken.x = 580 + Math.sin(t * 1.4 + 1.2) * orbit;
    this.aiToken.y = 210 + Math.cos(t * 1.6 + 0.7) * orbit;

    if (this.playerDodgingUntil > this.time.now) {
      this.playerToken.x -= 65 * (deltaMs / 1000);
    }

    if (this.aiDodgingUntil > this.time.now) {
      this.aiToken.x += 65 * (deltaMs / 1000);
    }

    this.playerToken.x = clamp(this.playerToken.x, 110, 330);
    this.aiToken.x = clamp(this.aiToken.x, 470, 690);
  }

  private attachListeners(): void {
    this.offCommand = subscribeArenaCommand((command) => {
      this.performAction("player", command, true);
    });

    this.offConfig = subscribeArenaConfig((config) => {
      this.config = config;
      if (this.playerToken && this.aiToken) {
        this.playerToken.fillColor = Phaser.Display.Color.HexStringToColor(BEYBLADES[config.playerBlade].color).color;
        this.aiToken.fillColor = Phaser.Display.Color.HexStringToColor(BEYBLADES[config.aiBlade].color).color;
      }
      this.resetFight();
      this.emitSystem(`New match config: ${BEYBLADES[config.playerBlade].name} vs ${BEYBLADES[config.aiBlade].name}.`);
    });

    this.offReset = subscribeArenaReset(() => {
      this.resetFight();
      this.emitSystem("Match reset.");
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offCommand?.();
      this.offConfig?.();
      this.offReset?.();
    });
  }

  private performAiAction(time: number): void {
    if (time < this.aiLockedUntil || this.winner) {
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
    const lock = actor === "player" ? this.playerLockedUntil : this.aiLockedUntil;

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
    if (actor === "player") {
      this.playerDodgingUntil = now + 360;
      this.playerLockedUntil = now + 460;
      this.emitLog("player", "Dodge!", "combat");
    } else {
      this.aiDodgingUntil = now + 360;
      this.aiLockedUntil = now + 460;
      this.emitLog("ai", "AI slips out of range.", "combat");
    }
  }

  private performAttack(actor: "player" | "ai"): void {
    const now = this.time.now;

    if (actor === "player") {
      this.playerLockedUntil = now + 720;
      this.emitLog("player", "Attack launched.", "combat");

      if (aiMayReactivelyDodge(this.config.difficulty) && now > this.aiLockedUntil + 30) {
        this.time.delayedCall(180, () => {
          if (!this.winner) {
            this.performDodge("ai");
          }
        });
      }

      this.time.delayedCall(300, () => this.resolveAttack("player"));
      return;
    }

    this.aiLockedUntil = now + 700;
    this.emitLog("ai", "AI attacks with pressure.", "combat");
    this.time.delayedCall(300, () => this.resolveAttack("ai"));
  }

  private performBitBeast(actor: "player" | "ai"): void {
    const now = this.time.now;
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
        this.playerBit = clamp(this.playerBit + 10, 0, MAX_BIT);
        this.aiBit = clamp(this.aiBit + 14, 0, MAX_BIT);
        this.emitLog("system", "Your attack missed. AI dodged cleanly.", "combat");
        emitTauntRequest({ trigger: "ai-dodge" });
        this.broadcastState();
        return;
      }

      const damage = 12 + Math.floor(Math.random() * 8);
      this.aiHp = clamp(this.aiHp - damage, 0, MAX_HP);
      this.playerBit = clamp(this.playerBit + 18, 0, MAX_BIT);
      this.emitLog("system", `Hit confirmed for ${damage}.`, "combat");
      this.maybeFinish();
      this.broadcastState();
      return;
    }

    if (this.playerDodgingUntil > now) {
      this.aiBit = clamp(this.aiBit + 10, 0, MAX_BIT);
      this.playerBit = clamp(this.playerBit + 14, 0, MAX_BIT);
      this.emitLog("system", "Dodge successful. You avoided the hit.", "combat");
      this.broadcastState();
      return;
    }

    const damage = 12 + Math.floor(Math.random() * 9);
    this.playerHp = clamp(this.playerHp - damage, 0, MAX_HP);
    this.aiBit = clamp(this.aiBit + 18, 0, MAX_BIT);
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
      this.emitLog("system", `Bit Beast crushes AI for ${damage}.`, "combat");
    } else {
      this.playerHp = clamp(this.playerHp - damage, 0, MAX_HP);
      this.emitLog("system", `AI Bit Beast hits you for ${damage}.`, "combat");
    }

    this.maybeFinish();
    this.broadcastState();
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
    this.aiThinkClock = 0;
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

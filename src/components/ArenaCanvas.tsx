"use client";

import { useEffect, useRef } from "react";

export function ArenaCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let game: import("phaser").Game | null = null;

    const boot = async () => {
      const Phaser = (await import("phaser")).default;
      const { BeybladeArenaScene } = await import("@/game/BeybladeArenaScene");

      if (!mounted || !containerRef.current) {
        return;
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: 800,
        height: 420,
        backgroundColor: "#08132b",
        parent: containerRef.current,
        scene: [BeybladeArenaScene],
        scale: {
          mode: Phaser.Scale.NONE,
          autoCenter: Phaser.Scale.CENTER_BOTH
        }
      });
    };

    boot();

    return () => {
      mounted = false;
      game?.destroy(true);
      game = null;
    };
  }, []);

  return <div className="arena-canvas" ref={containerRef} />;
}

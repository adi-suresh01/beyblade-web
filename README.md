# Beyblade Voice Arena

Real-time 2D Beyblade web game scaffold with:
- Next.js + TypeScript app infrastructure
- Phaser-powered arena combat loop (`attack`, `dodge`, `bit beast`)
- Launch sequence flow: setup -> 3/2/1 -> say "let it rip" to start
- 4 Beyblades: Dragoon, Dranzer, Draciel, Driger
- Browser speech recognition for low-latency voice input
- ElevenLabs TTS integration for both player + AI trash talk
- AI comeback route with optional LLM-backed roast generation

## Stack
- Next.js (App Router)
- React + Zustand
- Phaser 3
- ElevenLabs API (TTS)
- Optional: OpenAI Responses API (comeback quality)

## Quick Start
1. Install dependencies:
```bash
npm install
```
2. Copy env values:
```bash
cp .env.example .env.local
```
3. Fill required keys in `.env.local`:
- `ELEVENLABS_API_KEY`
- `NEXT_PUBLIC_ELEVENLABS_PLAYER_VOICE_ID`
- `NEXT_PUBLIC_ELEVENLABS_AI_VOICE_ID`

4. Start dev server:
```bash
npm run dev
```

## Controls
- Start flow:
  - Choose your Beyblade + difficulty
  - AI picks a random different Beyblade
  - Launch countdown runs, then say "let it rip" to enter battle
- Keyboard:
  - `A`: Attack
  - `D`: Dodge
  - `B`: Bit Beast (requires full meter)
- Voice command examples:
  - "attack"
  - "dodge"
  - "bit beast"
- Any non-command speech is treated as trash talk and routed to AI comeback.

## Project Structure
- `app/page.tsx`: Main UI entrypoint
- `src/components/ArenaCanvas.tsx`: Phaser mount
- `src/components/BeybladeGameClient.tsx`: HUD + controls + voice wiring
- `src/game/BeybladeArenaScene.ts`: Real-time combat scene
- `src/lib/game/*`: Domain models, AI behavior, event bus
- `src/lib/voice/*`: Intent parser, speech input hook, TTS playback
- `app/api/tts/route.ts`: ElevenLabs proxy
- `app/api/trash-talk/route.ts`: AI roast generation endpoint

## Notes
- Browser speech recognition support varies by browser.
- TTS is server-proxied to keep API keys off the client.
- Roast generation falls back to local lines when LLM keys are absent.

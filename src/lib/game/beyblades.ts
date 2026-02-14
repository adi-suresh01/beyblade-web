import { BeybladeProfile, BEYBLADE_IDS, BeybladeId } from "@/lib/game/types";

export const BEYBLADES: Record<BeybladeId, BeybladeProfile> = {
  dragoon: {
    id: "dragoon",
    name: "Dragoon",
    color: "#4bc3ff",
    bitBeast: "Blue Dragon",
    flavor: "Aggressive attacker with burst pressure."
  },
  dranzer: {
    id: "dranzer",
    name: "Dranzer",
    color: "#ff7a45",
    bitBeast: "Crimson Phoenix",
    flavor: "Explosive offense and punishing counter-strikes."
  },
  draciel: {
    id: "draciel",
    name: "Draciel",
    color: "#38c6a7",
    bitBeast: "Iron Turtle",
    flavor: "Heavy defense with stubborn survivability."
  },
  driger: {
    id: "driger",
    name: "Driger",
    color: "#ffd84d",
    bitBeast: "White Tiger",
    flavor: "Balanced speed and tracking pressure."
  }
};

export const BEYBLADE_LIST: BeybladeProfile[] = BEYBLADE_IDS.map((id) => BEYBLADES[id]);

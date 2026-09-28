import type { GameSpec } from "../schema/gameSpec";
import alienPhoneFilm from "./alien-phone-film.json";
import toiletCultivation from "./toilet-cultivation.json";
import pigeonCareer from "./pigeon-career.json";

export const SAMPLES: GameSpec[] = [
  alienPhoneFilm as unknown as GameSpec,
  toiletCultivation as unknown as GameSpec,
  pigeonCareer as unknown as GameSpec,
];

export function getSample(id: string): GameSpec | undefined {
  return SAMPLES.find((s) => s.metadata.id === id);
}

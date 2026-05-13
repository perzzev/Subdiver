export type SampleEpisode = {
  slug: string;
  season: number;
  episode: number;
  title: string;
  fileName: string;
};

export const sampleEpisodes: SampleEpisode[] = [
  {
    slug: "maskers",
    season: 1,
    episode: 1,
    title: "Maskers",
    fileName: "maskers_1.nl.vtt",
  },
  {
    slug: "graaiers",
    season: 1,
    episode: 2,
    title: "Graaiers",
    fileName: "graaiers.nl.vtt",
  },
  {
    slug: "de-buitenstaander",
    season: 1,
    episode: 3,
    title: "De buitenstaander",
    fileName: "de-buitenstaander.nl.vtt",
  },
  {
    slug: "glazen-plafond",
    season: 1,
    episode: 4,
    title: "Glazen plafond",
    fileName: "glazen-plafond.nl.vtt",
  },
  {
    slug: "chinese-walls",
    season: 1,
    episode: 5,
    title: "Chinese walls",
    fileName: "chinese-walls.nl.vtt",
  },
  {
    slug: "fee-burners",
    season: 1,
    episode: 6,
    title: "Fee burners",
    fileName: "fee-burners.nl.vtt",
  },
  {
    slug: "woekerpolis",
    season: 1,
    episode: 7,
    title: "Woekerpolis",
    fileName: "woekerpolis.nl.vtt",
  },
  {
    slug: "de-rogue-trader",
    season: 1,
    episode: 8,
    title: "De rogue trader",
    fileName: "de-rogue-trader.nl.vtt",
  },
];

export function getSampleUrl(fileName: string) {
  return `${import.meta.env.BASE_URL}samples/${fileName}`;
}

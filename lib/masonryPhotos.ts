// Flat photo lists for the masonry-style /headshots, /creative-portraits,
// and /music pages — deliberately separate from components/Gallery.tsx's
// GalleryGroup/GalleryBlock shape (single/pair blocks), which /photos still
// uses directly via HEADSHOTS_GALLERY/CREATIVE_PORTRAITS_GALLERY in
// lib/services.ts. A masonry tile's shape comes entirely from the photo's
// own width/height — no block/crop concept needed.
import { publicImageUrl } from "@/lib/media";

export type MasonryPhoto = {
  key: string;
  width: number;
  height: number;
  alt: string;
  src: string;
};

// Pasting a real photo entry from `npm run image:upload`'s printed snippet
// (which uses `src: publicImageUrl("...")`) requires adding
// `import { publicImageUrl } from "@/lib/media";` at the top of this file.

// Order below is deliberately randomized (not upload order or filename
// order) per request — re-shuffle by hand if you add/remove entries and
// want a fresh order, there's no automatic randomization at render time.
export const HEADSHOTS_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "headshots/toriamos-22991.jpg",
    width: 2996,
    height: 4503,
    alt: "Black-and-white portrait of a woman in wire-frame glasses and an oversized sweater, head tilted sharply right, wavy hair cascading past one shoulder, soft window light on her face against a plain backdrop.",
    src: publicImageUrl("headshots/toriamos-22991.jpg"),
  },
  {
    key: "headshots/toriamos-35751.jpg",
    width: 2971,
    height: 3714,
    alt: "Black-and-white close-up of a woman with long wavy dark hair, eyes cast down and slight smirk, sunlight rimming one side of her hair against a black background, wearing a white top.",
    src: publicImageUrl("headshots/toriamos-35751.jpg"),
  },
  {
    key: "headshots/matt.jpg",
    width: 3509,
    height: 4679,
    alt: "Close-up portrait against a dark teal backdrop of a young man with a two-tone mullet, orange-bleached fringe over dark roots, septum ring, chin and cheek piercings, and a faint scar above his eyebrow, dramatic side lighting casting half his face in shadow, wearing a black graphic tee and a beaded chain necklace.",
    src: publicImageUrl("headshots/matt.jpg"),
  },
  {
    key: "headshots/toriamos-44551.jpg",
    width: 4024,
    height: 6048,
    alt: "Black-and-white close-up of a young woman with wavy hair parted to one side, gazing off-camera with a subtle closed-mouth expression, dramatic side lighting fading into a black background.",
    src: publicImageUrl("headshots/toriamos-44551.jpg"),
  },
  {
    key: "headshots/lucas.jpg",
    width: 6048,
    height: 4024,
    alt: "Black-and-white portrait of a man with dark tousled hair, faint forehead crease, and light stubble, dramatic side lighting on the left half of his face fading to black on the right, wearing a dark crewneck top against a pure black background.",
    src: publicImageUrl("headshots/lucas.jpg"),
  },
  {
    key: "headshots/toriamos-80391.jpg",
    width: 2734,
    height: 4109,
    alt: "Black-and-white close-up portrait of a woman with voluminous curly dark hair, chin tilted up, faint smile, wearing an open white collared shirt against a dark background with strong side lighting sculpting her cheekbone.",
    src: publicImageUrl("headshots/toriamos-80391.jpg"),
  },
  {
    key: "headshots/mackenzie-30.jpg",
    width: 3991,
    height: 5999,
    alt: "Black-and-white side-profile close-up of a woman gazing upward, sharp cat-eye liner with dripping lines under one eye, septum ring, dark lips, and a chunky chain-link choker layered with metal ring pendants against a soft white background.",
    src: publicImageUrl("headshots/mackenzie-30.jpg"),
  },
  {
    key: "headshots/angel-2.jpg",
    width: 3732,
    height: 2460,
    alt: "Close-up of a woman with voluminous curled bronde hair gazing to her left, smoky eyeliner and glossy red lips, wearing a beaded gemstone choker and off-shoulder red floral top against a plain gray backdrop.",
    src: publicImageUrl("headshots/angel-2.jpg"),
  },
  {
    key: "headshots/toriamos-10252531.jpg",
    width: 1004,
    height: 1506,
    alt: "Extreme close-up of a woman's face lit in split teal-blue tones, dark eyes glancing down-left, faint smile, small hoop nose ring catching the light.",
    src: publicImageUrl("headshots/toriamos-10252531.jpg"),
  },
  {
    key: "headshots/toriamos-10251321.jpg",
    width: 1400,
    height: 2100,
    alt: "Close-up of a woman with dark blunt-cut bangs, eyes closed and chin tilted down, nose ring visible, thin dried vines hanging vertically across her face and fern-tattooed shoulder, warm amber lighting.",
    src: publicImageUrl("headshots/toriamos-10251321.jpg"),
  },
];

export const CREATIVE_PORTRAITS_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "creative-portraits-placeholder-01",
    width: 1067,
    height: 1600,
    alt: "Art-directed creative portrait session in Columbia, MO",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-01/1067/1600",
  },
  {
    key: "creative-portraits-placeholder-02",
    width: 1600,
    height: 1067,
    alt: "Styled creative portrait photography in Mid-Missouri",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-02/1600/1067",
  },
  {
    key: "creative-portraits-placeholder-03",
    width: 1200,
    height: 1800,
    alt: "Concept-driven portrait session, Columbia Missouri photographer",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-03/1200/1800",
  },
  {
    key: "creative-portraits-placeholder-04",
    width: 1500,
    height: 1000,
    alt: "Art-directed lighting and styling, Mid-Missouri portrait session",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-04/1500/1000",
  },
  {
    key: "creative-portraits-placeholder-05",
    width: 1400,
    height: 1400,
    alt: "Creative portrait photography session in Columbia, MO",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-05/1400/1400",
  },
  {
    key: "creative-portraits-placeholder-06",
    width: 1800,
    height: 1200,
    alt: "Narrative-driven portrait session, Mid-Missouri photographer",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-06/1800/1200",
  },
  {
    key: "ocean-of-slumber",
    width: 5077,
    height: 3378,
    alt: "Black-and-white editorial group portrait: a woman with long dreadlocks, dark makeup, and a feathered collar stands in front of four bearded bandmates in a dramatic, gothic-toned session",
    src: "https://pub-a78d2319f08941ff9a3249390ab8f644.r2.dev/ocean-of-slumber.jpg",
  },
];

export const BOUDOIR_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "boudoir-placeholder-01",
    width: 1067,
    height: 1600,
    alt: "Fine art boudoir photography session in Columbia, Missouri",
    src: "https://picsum.photos/seed/boudoir-placeholder-01/1067/1600",
  },
  {
    key: "boudoir-placeholder-02",
    width: 1600,
    height: 1067,
    alt: "Intimate boudoir photography, Mid-Missouri photographer",
    src: "https://picsum.photos/seed/boudoir-placeholder-02/1600/1067",
  },
  {
    key: "boudoir-placeholder-03",
    width: 1200,
    height: 1800,
    alt: "Fine art nude photography session in Columbia, MO",
    src: "https://picsum.photos/seed/boudoir-placeholder-03/1200/1800",
  },
  {
    key: "boudoir-placeholder-04",
    width: 1500,
    height: 1000,
    alt: "Boudoir photography styled with natural light, Mid-Missouri",
    src: "https://picsum.photos/seed/boudoir-placeholder-04/1500/1000",
  },
  {
    key: "boudoir-placeholder-05",
    width: 1400,
    height: 1400,
    alt: "Intimate portrait session, Columbia, Missouri photographer",
    src: "https://picsum.photos/seed/boudoir-placeholder-05/1400/1400",
  },
  {
    key: "boudoir-placeholder-06",
    width: 1800,
    height: 1200,
    alt: "Fine art boudoir and nude photography, Mid-Missouri",
    src: "https://picsum.photos/seed/boudoir-placeholder-06/1800/1200",
  },
];

export const MUSIC_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "music-placeholder-01",
    width: 1800,
    height: 1200,
    alt: "Concert and live performance photography, wide stage shot",
    src: "https://picsum.photos/seed/music-placeholder-01/1800/1200",
  },
  {
    key: "music-placeholder-02",
    width: 1067,
    height: 1600,
    alt: "Live music performance photography, vertical stage shot",
    src: "https://picsum.photos/seed/music-placeholder-02/1067/1600",
  },
  {
    key: "music-placeholder-03",
    width: 1600,
    height: 1067,
    alt: "Concert photography capturing a live band performance",
    src: "https://picsum.photos/seed/music-placeholder-03/1600/1067",
  },
  {
    key: "music-placeholder-04",
    width: 1400,
    height: 1400,
    alt: "Live performance photography, close crowd and stage lighting",
    src: "https://picsum.photos/seed/music-placeholder-04/1400/1400",
  },
  {
    key: "music-placeholder-05",
    width: 1200,
    height: 1800,
    alt: "Concert photography, vertical shot of a solo performer",
    src: "https://picsum.photos/seed/music-placeholder-05/1200/1800",
  },
  {
    key: "music-placeholder-06",
    width: 1800,
    height: 1200,
    alt: "Live music photography, wide shot of stage lighting and performer",
    src: "https://picsum.photos/seed/music-placeholder-06/1800/1200",
  },
];

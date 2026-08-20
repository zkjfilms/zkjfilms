// Flat photo lists for the masonry-style /headshots and /creative-portraits
// pages — deliberately separate from components/Gallery.tsx's GalleryGroup/
// GalleryBlock shape (single/pair blocks), which /portraits still uses
// directly via HEADSHOTS_GALLERY/CREATIVE_PORTRAITS_GALLERY in
// lib/services.ts. A masonry tile's shape comes entirely from the photo's
// own width/height — no block/crop concept needed.
export type MasonryPhoto = {
  key: string;
  width: number;
  height: number;
  alt: string;
  src: string;
};

// Placeholder photos with deliberately varied real dimensions (landscape,
// portrait, and near-square) so the masonry grid shows a genuine mixed
// layout before any real photos are uploaded. Replace with real entries —
// each one printed ready-to-paste by `npm run image:upload` — as photos
// come in.
export const HEADSHOTS_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "headshots-placeholder-01",
    width: 1600,
    height: 1067,
    alt: "Professional headshot photography session in Columbia, Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-01/1600/1067",
  },
  {
    key: "headshots-placeholder-02",
    width: 1067,
    height: 1600,
    alt: "Business branding portrait photographed in Mid-Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-02/1067/1600",
  },
  {
    key: "headshots-placeholder-03",
    width: 1400,
    height: 1400,
    alt: "Corporate headshot session, Columbia MO photography studio",
    src: "https://picsum.photos/seed/headshots-placeholder-03/1400/1400",
  },
  {
    key: "headshots-placeholder-04",
    width: 1200,
    height: 1800,
    alt: "LinkedIn profile headshot photographed in Mid-Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-04/1200/1800",
  },
  {
    key: "headshots-placeholder-05",
    width: 1800,
    height: 1200,
    alt: "Professional branding portrait, Columbia Missouri photographer",
    src: "https://picsum.photos/seed/headshots-placeholder-05/1800/1200",
  },
  {
    key: "headshots-placeholder-06",
    width: 1000,
    height: 1500,
    alt: "Personal website headshot session in Mid-Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-06/1000/1500",
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
];

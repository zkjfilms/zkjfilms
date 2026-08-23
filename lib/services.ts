import type { GalleryGroup } from "@/components/Gallery";
import { publicImageUrl } from "@/lib/media";
import type { MasonryPhoto } from "@/lib/masonryPhotos";
import { HEADSHOTS_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS, BOUDOIR_MASONRY_PHOTOS, MUSIC_MASONRY_PHOTOS } from "@/lib/masonryPhotos";

export type Service = {
  slug: string;
  name: string;
  appointmentTypeName: string;
  tagline: string;
  description: string;
  heroImageSeed: string;
  heroImageUrl?: string;
  heroImageAlt: string;
  gallery: GalleryGroup | null;
  masonryPhotos?: MasonryPhoto[];
  faqIds: string[];
};

export const HEADSHOTS_GALLERY: GalleryGroup = {
  title: "Headshots & Branding",
  description:
    "Professional portraits for people who need to show up polished: LinkedIn, business branding, personal websites, and professional profiles.",
  blocks: [
    {
      type: "single",
      items: [
        {
          seed: "nocturne-portrait-01",
          index: 1,
          alt: "Professional headshot session in Columbia, Missouri",
        },
      ],
    },
    {
      type: "single",
      items: [
        {
          seed: "nocturne-portrait-02",
          index: 2,
          alt: "Business branding portrait photographed in Mid-Missouri",
        },
      ],
    },
  ],
};

export const CREATIVE_PORTRAITS_GALLERY: GalleryGroup = {
  title: "Creative Portraits",
  description:
    "More personal, more art-directed. Lighting, styling, and concept-driven sessions for people who want something beyond a standard portrait.",
  blocks: [
    {
      type: "pair",
      items: [
        {
          seed: "nocturne-portrait-03",
          index: 1,
          alt: "Art-directed creative portrait session in Columbia, MO",
        },
        {
          seed: "nocturne-portrait-04",
          index: 2,
          alt: "Styled creative portrait photography in Mid-Missouri",
        },
      ],
    },
    {
      type: "single",
      items: [
        {
          seed: "nocturne-portrait-05",
          index: 3,
          src: publicImageUrl("ocean-of-slumber.jpg"),
          alt: "Black-and-white editorial group portrait: a woman with long dreadlocks, dark makeup, and a feathered collar stands in front of four bearded bandmates in a dramatic, gothic-toned session",
        },
      ],
    },
  ],
};

export const MUSIC_GALLERY: GalleryGroup = {
  title: "Music & Performance",
  description:
    "Concert and live-performance photography — bands, solo artists, and venues, captured in the moment.",
  blocks: [
    {
      type: "single",
      items: [
        {
          seed: "nocturne-music-01",
          index: 1,
          alt: "Concert photography, live band performance, Columbia, Missouri",
        },
      ],
    },
    {
      type: "single",
      items: [
        {
          seed: "nocturne-music-02",
          index: 2,
          alt: "Live performance photography, solo artist on stage",
        },
      ],
    },
  ],
};

export const HEADSHOTS_SERVICE: Service = {
  slug: "headshots",
  name: "Headshots",
  appointmentTypeName: "Professional Headshots",
  tagline: "Polished, professional, and unmistakably you.",
  description:
    "Professional portraits for people who need to show up polished — LinkedIn, business branding, personal websites, and professional profiles. Clean, confident, and ready for wherever you need to make a first impression.",
  heroImageSeed: "nocturne-headshots-hero",
  heroImageAlt:
    "Professional headshot photography session in Columbia, Missouri.",
  gallery: null,
  masonryPhotos: HEADSHOTS_MASONRY_PHOTOS,
  faqIds: ["what-to-wear", "session-length"],
};

export const CREATIVE_PORTRAITS_SERVICE: Service = {
  slug: "creative-portraits",
  name: "Creative Portraits",
  appointmentTypeName: "Creative Portraits",
  tagline: "Art-directed portraits, built around a concept.",
  description:
    "More personal, more art-directed. Lighting, styling, and concept-driven sessions for people who want something beyond a standard portrait — a set of images that actually feels like you.",
  heroImageSeed: "nocturne-creative-hero",
  heroImageAlt:
    "Art-directed creative portrait photography session in Columbia, Missouri.",
  gallery: null,
  masonryPhotos: CREATIVE_PORTRAITS_MASONRY_PHOTOS,
  faqIds: ["what-to-wear", "session-what-happens"],
};

export const BOUDOIR_SERVICE: Service = {
  slug: "boudoir",
  name: "Boudoir & Fine Art Nude",
  appointmentTypeName: "Fine Art Boudoir & Nude",
  tagline: "Intimate work, entirely on your terms.",
  description:
    "Boudoir and fine art nude photography built around trust. This is some of the most personal work I do — shaped entirely around what you're comfortable with, at whatever pace feels right. Every image stays private unless you decide otherwise: fully public, cropped and anonymous, or never shared at all.",
  heroImageSeed: "nocturne-boudoir-hero",
  heroImageAlt: "Fine art boudoir photography session in Columbia, Missouri.",
  gallery: null,
  masonryPhotos: BOUDOIR_MASONRY_PHOTOS,
  faqIds: ["privacy-boudoir", "sign-anything"],
};

export const MUSIC_SERVICE: Service = {
  slug: "music",
  name: "Music & Performance",
  appointmentTypeName: "Music & Performance Photography",
  tagline: "Live energy, captured from the pit.",
  description:
    "Concert and live-performance photography — bands, solo artists, and venues, shot in the moment. Booked directly by artists, venues, or labels for promo, press, and archival use.",
  heroImageSeed: "nocturne-music-hero",
  heroImageUrl: publicImageUrl("music/ZJ7_2203.jpg"),
  heroImageAlt:
    "Long-haired, bearded man in a fedora hat plays pedal steel guitar with a mallet, blue-lit from below against a dark red wall strung with colorful fairy lights.",
  gallery: null,
  masonryPhotos: MUSIC_MASONRY_PHOTOS,
  faqIds: ["session-length", "music-venue-access", "music-usage-rights"],
};

export const SERVICES: Service[] = [
  HEADSHOTS_SERVICE,
  CREATIVE_PORTRAITS_SERVICE,
  BOUDOIR_SERVICE,
  MUSIC_SERVICE,
];

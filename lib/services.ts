import type { GalleryGroup } from "@/components/Gallery";
import { publicImageUrl } from "@/lib/media";

export type Service = {
  slug: string;
  name: string;
  appointmentTypeName: string;
  tagline: string;
  description: string;
  heroImageSeed: string;
  heroImageAlt: string;
  gallery: GalleryGroup | null;
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
  gallery: HEADSHOTS_GALLERY,
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
  gallery: CREATIVE_PORTRAITS_GALLERY,
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
  faqIds: ["privacy-boudoir", "sign-anything"],
};

export const SERVICES: Service[] = [
  HEADSHOTS_SERVICE,
  CREATIVE_PORTRAITS_SERVICE,
  BOUDOIR_SERVICE,
];

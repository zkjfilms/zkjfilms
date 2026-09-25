import { publicImageUrl } from "@/lib/media";
import type { MasonryPhoto } from "@/lib/masonryPhotos";
import { HEADSHOTS_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS, BOUDOIR_MASONRY_PHOTOS, MUSIC_MASONRY_PHOTOS } from "@/lib/masonryPhotos";
import { LATE_NIGHT_LISTENING_URL } from "@/lib/seo";

export type Service = {
  slug: string;
  name: string;
  appointmentTypeName: string;
  tagline: string;
  description: string;
  heroImageSeed: string;
  heroImageUrl?: string;
  // CSS object-position for the hero <Image> (e.g. "center 15%") — the hero
  // section is a tall (min-h-[70vh]) object-cover crop, so a real photo
  // whose subject isn't near the vertical center needs this or the subject
  // gets cropped out entirely. Unused (defaults to center) for the
  // picsum.photos placeholders, whose framing doesn't matter.
  heroImagePosition?: string;
  heroImageAlt: string;
  masonryPhotos?: MasonryPhoto[];
  faqIds: string[];
  relatedLink?: { label: string; href: string };
};

export const HEADSHOTS_SERVICE: Service = {
  slug: "headshots",
  name: "Headshots",
  appointmentTypeName: "Professional Headshots",
  tagline: "Polished, professional, and unmistakably you.",
  description:
    "Professional portraits for people who need to show up polished — LinkedIn, business branding, personal websites, and professional profiles. Clean, confident, and ready for wherever you need to make a first impression.",
  heroImageSeed: "nocturne-headshots-hero",
  heroImageUrl: publicImageUrl("headshots/lucas.jpg"),
  heroImagePosition: "center 10%",
  heroImageAlt:
    "Black-and-white portrait of a man with dark tousled hair, faint forehead crease, and light stubble, dramatic side lighting on the left half of his face fading to black on the right, wearing a dark crewneck top against a pure black background.",
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
  heroImageUrl: publicImageUrl("creative-portraits/KwaniHero.jpg"),
  heroImageAlt:
    "Low-angle silhouette of a woman in a black slip dress, head tilted back and one fist raised above her hair, against a pale hazy sky in this Columbia, Missouri portrait.",
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
  heroImageUrl: publicImageUrl("boudoir/AnonBanner.jpg"),
  heroImageAlt: "Fine art boudoir photography session in Columbia, Missouri.",
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
  masonryPhotos: MUSIC_MASONRY_PHOTOS,
  faqIds: ["session-length", "music-venue-access", "music-usage-rights"],
  relatedLink: {
    label: "See it in action → Late Night Listening",
    href: LATE_NIGHT_LISTENING_URL,
  },
};

export const SERVICES: Service[] = [
  CREATIVE_PORTRAITS_SERVICE,
  BOUDOIR_SERVICE,
  MUSIC_SERVICE,
  HEADSHOTS_SERVICE,
];

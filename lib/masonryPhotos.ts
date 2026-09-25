// Flat photo lists for the masonry-style /headshots, /creative-portraits,
// and /music pages. A masonry tile's shape comes entirely from the photo's
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
// You don't need to hand-balance the tail so a column doesn't hang past
// its neighbors, though — MasonryGallery places photos with a greedy
// shortest-column-first algorithm that keeps this order but evens out
// column heights on its own. Just add/remove/shuffle for variety.
export const HEADSHOTS_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "headshots/grace-09039.jpg",
    width: 3058,
    height: 4587,
    alt: "Woman with long wavy caramel-highlighted hair centered part, green eyes, glossy nude lipstick, smiling directly at camera in black blazer, rust top, and gold sapphire pendant against a blush-pink backdrop.",
    src: publicImageUrl("headshots/grace-09039.jpg"),
  },
  {
    key: "headshots/anon-054601.jpg",
    width: 3235,
    height: 4852,
    alt: "Close-cropped headshot of a mustached man in black-framed glasses and gray suit, dramatic side lighting illuminating his face against a nearly black background.",
    src: publicImageUrl("headshots/anon-054601.jpg"),
  },
  {
    key: "headshots/toriamos-22991.jpg",
    width: 2996,
    height: 4503,
    alt: "Black-and-white portrait of a woman in wire-frame glasses and an oversized sweater, head tilted sharply right, wavy hair cascading past one shoulder, soft window light on her face against a plain backdrop.",
    src: publicImageUrl("headshots/toriamos-22991.jpg"),
  },
  {
    key: "headshots/mackenzie-30.jpg",
    width: 3991,
    height: 5999,
    alt: "Black-and-white side-profile close-up of a woman gazing upward, sharp cat-eye liner with dripping lines under one eye, septum ring, dark lips, and a chunky chain-link choker layered with metal ring pendants against a soft white background.",
    src: publicImageUrl("headshots/mackenzie-30.jpg"),
  },
  {
    key: "headshots/lucas-17201.jpg",
    width: 4024,
    height: 5030,
    alt: "Man with tousled brown hair and light stubble looks off to the right, face lit warmly from below-left, dark t-shirt fading into black background.",
    src: publicImageUrl("headshots/lucas-17201.jpg"),
  },
  {
    key: "headshots/toriamos-80391.jpg",
    width: 2734,
    height: 4109,
    alt: "Black-and-white close-up portrait of a woman with voluminous curly dark hair, chin tilted up, faint smile, wearing an open white collared shirt against a dark background with strong side lighting sculpting her cheekbone.",
    src: publicImageUrl("headshots/toriamos-80391.jpg"),
  },
  {
    key: "headshots/angel-2.jpg",
    width: 3732,
    height: 2460,
    alt: "Close-up of a woman with voluminous curled bronde hair gazing to her left, smoky eyeliner and glossy red lips, wearing a beaded gemstone choker and off-shoulder red floral top against a plain gray backdrop.",
    src: publicImageUrl("headshots/angel-2.jpg"),
  },
  {
    key: "headshots/matt.jpg",
    width: 3509,
    height: 4679,
    alt: "Close-up portrait against a dark teal backdrop of a young man with a two-tone mullet, orange-bleached fringe over dark roots, septum ring, chin and cheek piercings, and a faint scar above his eyebrow, dramatic side lighting casting half his face in shadow, wearing a black graphic tee and a beaded chain necklace.",
    src: publicImageUrl("headshots/matt.jpg"),
  },
  {
    key: "headshots/toriamos-35751.jpg",
    width: 2971,
    height: 3714,
    alt: "Black-and-white close-up of a woman with long wavy dark hair, eyes cast down and slight smirk, sunlight rimming one side of her hair against a black background, wearing a white top.",
    src: publicImageUrl("headshots/toriamos-35751.jpg"),
  },
  {
    key: "headshots/dennis.jpg",
    width: 1252,
    height: 1378,
    alt: "Close-up black-and-white portrait of a heavyset man in a patterned shirt, furrowed brow, eyes cast to the side, deep shadow engulfing half his face.",
    src: publicImageUrl("headshots/dennis.jpg"),
  },
  {
    key: "headshots/toriamos-10251321.jpg",
    width: 1400,
    height: 2100,
    alt: "Close-up of a woman with dark blunt-cut bangs, eyes closed and chin tilted down, nose ring visible, thin dried vines hanging vertically across her face and fern-tattooed shoulder, warm amber lighting.",
    src: publicImageUrl("headshots/toriamos-10251321.jpg"),
  },
  {
    key: "headshots/toriamos-44551.jpg",
    width: 4024,
    height: 6048,
    alt: "Black-and-white close-up of a young woman with wavy hair parted to one side, gazing off-camera with a subtle closed-mouth expression, dramatic side lighting fading into a black background.",
    src: publicImageUrl("headshots/toriamos-44551.jpg"),
  },
  {
    key: "headshots/traci.jpg",
    width: 3041,
    height: 4562,
    alt: "Woman with curly hair swept up, teal-framed cat-eye glasses, and red lipstick gazes upward as amber light warms her face and blue light rims her ear and earring against total black.",
    src: publicImageUrl("headshots/traci.jpg"),
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

// Only client-approved, publicly-releasable images belong here — add new
// ones with `npm run image:upload -- <file> boudoir/gallery/<file>` (real
// dimensions are printed for you to paste in). Uploaded to the R2 public
// bucket rather than committed to git, since this gallery has grown to
// 300+ MB of full-res exports, which would otherwise bloat the repo
// permanently — see lib/media.ts.
//
// Order is pre-interleaved by session/subject (round-robin across
// filename-derived groups — "Andi-8968138.jpg", "anon-27571.jpg",
// "anon13.jpg" — so consecutive grid images aren't from the same shoot),
// not upload order. Re-shuffle by hand if you add/remove entries.
//
// Alt text is intentionally generic (no client names or identifying
// detail) — the vision model that drafts alt text for every other gallery
// also declines to describe boudoir/nude content in more specific terms,
// so a real per-photo description isn't an option here regardless.
export const BOUDOIR_MASONRY_PHOTOS: MasonryPhoto[] = [
  { key: "boudoir/gallery/Andi-8968138.jpg", width: 3880, height: 5831 },
  { key: "boudoir/gallery/TRA_2561-Edit.jpg", width: 5753, height: 3828 },
  { key: "boudoir/gallery/TRA_2576-Edit.jpg", width: 6048, height: 4024 },
  { key: "boudoir/gallery/TRA_2579-Edit.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/TRA_2587-Edit.jpg", width: 3450, height: 2295 },
  { key: "boudoir/gallery/TRA_2590-Edit.jpg", width: 3718, height: 2474 },
  { key: "boudoir/gallery/TRA_2602-Edit.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-27571.jpg", width: 5693, height: 3788 },
  { key: "boudoir/gallery/anon1.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-28741.jpg", width: 4912, height: 3268 },
  { key: "boudoir/gallery/anon10.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-29111.jpg", width: 5309, height: 3532 },
  { key: "boudoir/gallery/anon11.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-44911.jpg", width: 5186, height: 3450 },
  { key: "boudoir/gallery/anon13.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-45931.jpg", width: 3807, height: 5722 },
  { key: "boudoir/gallery/anon15.jpg", width: 1587, height: 2380 },
  { key: "boudoir/gallery/anon-46001.jpg", width: 5762, height: 3834 },
  { key: "boudoir/gallery/anon2.jpg", width: 6048, height: 4024 },
  { key: "boudoir/gallery/anon-46661.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon3.jpg", width: 5380, height: 3580 },
  { key: "boudoir/gallery/anon-47071.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon4.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-47161.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon5.jpg", width: 6048, height: 4024 },
  { key: "boudoir/gallery/anon-47291.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon6.jpg", width: 3884, height: 5838 },
  { key: "boudoir/gallery/anon7.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon9.jpg", width: 3092, height: 4647 },
].map((photo, i) => ({
  ...photo,
  alt: `Fine art boudoir photography session in Columbia, Missouri — image ${i + 1}`,
  src: publicImageUrl(photo.key),
}));

export const MUSIC_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "music/ZJ7_9472.jpg",
    width: 2048,
    height: 1363,
    alt: "Long-exposure concert photo of a guitarist with head tilted back, red and teal light trails swirling around their torso and instrument, dark audience silhouettes framing left and right.",
    src: publicImageUrl("music/ZJ7_9472.jpg"),
  },
  {
    key: "music/P1033772.jpg",
    width: 6000,
    height: 4000,
    alt: "Black-and-white stage shot from behind the crowd: silhouetted hands raised in horns, a guitarist lifting his instrument overhead, long-haired bassist and drummer lit by three hazy backlights.",
    src: publicImageUrl("music/P1033772.jpg"),
  },
  {
    key: "music/ZJ7_8365.jpg",
    width: 3219,
    height: 4024,
    alt: "Bearded saxophonist with shaggy hair bowed over his instrument, silhouetted against a bright backlight beside two stage microphones.",
    src: publicImageUrl("music/ZJ7_8365.jpg"),
  },
  {
    key: "music/ZJ7_1511-2.jpg",
    width: 6048,
    height: 4024,
    alt: "Trumpet player with green-painted face and shaved head plays mid-note beside a spike-crowned, mask-wearing guitarist lit in dim red-orange stage light.",
    src: publicImageUrl("music/ZJ7_1511-2.jpg"),
  },
  {
    key: "music/ZJ7_2204.jpg",
    width: 6048,
    height: 4024,
    alt: "Bearded man with long gray hair bent over a wooden cajon-like instrument on stage, blue lighting casting his profile against a red wall strung with colorful string lights.",
    src: publicImageUrl("music/ZJ7_2204.jpg"),
  },
  {
    key: "music/ZJ7_5662.jpg",
    width: 6048,
    height: 4024,
    alt: "Black-and-white stage shot of a shirtless-armed singer in a white t-shirt and dark jeans, bent backward with one tattooed arm raised and fingers splayed, mic cable trailing down, silhouetted figures faintly visible in the dark foreground.",
    src: publicImageUrl("music/ZJ7_5662.jpg"),
  },
  {
    key: "music/Opeth_4.jpg",
    width: 4940,
    height: 3293,
    alt: "Long-haired musician in a black wide-brimmed hat, mouth open mid-shout, gripping a white PRS guitar neck beside an angled boom microphone in hazy monochrome stage light.",
    src: publicImageUrl("music/Opeth_4.jpg"),
  },
  {
    key: "music/ZJ7_9515-2.jpg",
    width: 1638,
    height: 2048,
    alt: "Blurred silhouette bending forward with arm raised near face, set against teal light with two clusters of orange spark trails streaking diagonally in the foreground.",
    src: publicImageUrl("music/ZJ7_9515-2.jpg"),
  },
  {
    key: "music/P1033695.jpg",
    width: 6000,
    height: 4000,
    alt: "Low-angle black-and-white shot of a shaggy-haired guitarist gripping a dark flying-V guitar, hair blown mid-motion, silhouetted against a bright circular stage light.",
    src: publicImageUrl("music/P1033695.jpg"),
  },
  {
    key: "music/ZJ7_0909.jpg",
    width: 6048,
    height: 4024,
    alt: "Bob-haired guitarist in a black graphic tank top plays a red guitar with an illuminated effects unit clipped to the strap, bathed in blue stage light, eyes cast down toward the fretboard.",
    src: publicImageUrl("music/ZJ7_0909.jpg"),
  },
  {
    key: "music/ZJ7_9269.jpg",
    width: 6048,
    height: 4024,
    alt: "Two hooded, masked guitarists on a smoky stage, front figure with foot propped on a monitor and guitar tilted upward, second musician crouched behind mid-strum, both lit in dim teal-blue haze.",
    src: publicImageUrl("music/ZJ7_9269.jpg"),
  },
  {
    key: "music/RC_D_B-838432.jpg",
    width: 6048,
    height: 4024,
    alt: "Bearded, long-haired bassist mid-scream at a low-angle stage shot, tattooed forearm gripping the fretboard, drum kit and flame-patterned backdrop blurred behind him.",
    src: publicImageUrl("music/RC_D_B-838432.jpg"),
  },
  {
    key: "music/ZJ7_5851.jpg",
    width: 5291,
    height: 3520,
    alt: "Bald male performer clenching a corded microphone to his mouth with a wristband-clad fist, brow furrowed, satin floral jacket open over a tank top, spotlight cutting through darkness behind him.",
    src: publicImageUrl("music/ZJ7_5851.jpg"),
  },
  {
    key: "music/ZJ7_6290.jpg",
    width: 2048,
    height: 1363,
    alt: "Two corpse-painted black metal musicians onstage, one in spiked shoulder armor and tall spiked boots striking a wide-legged pose with a V-shaped guitar, the other in a sleeveless black shirt playing bass with foot propped on a monitor, thick fog and backlit haze behind a partly obscured band logo.",
    src: publicImageUrl("music/ZJ7_6290.jpg"),
  },
  {
    key: "music/ZJ7_9441-2.jpg",
    width: 1638,
    height: 2048,
    alt: "Silhouetted metal vocalist in profile, head tilted back, hair flying upward, one knee raised on stage riser, gripping a mic wrapped in frayed fabric against hazy backlit fog.",
    src: publicImageUrl("music/ZJ7_9441-2.jpg"),
  },
  {
    key: "music/ZJ7_1330-2.jpg",
    width: 6048,
    height: 4024,
    alt: "Long-exposure blur of a musician swinging their head, orange stage light trailing through hair like flames, a hand gripping a guitar neck in the dark foreground, small red light glowing bottom right.",
    src: publicImageUrl("music/ZJ7_1330-2.jpg"),
  },
  {
    key: "music/ZJ7_5642.jpg",
    width: 2968,
    height: 1975,
    alt: "Person in a dark hood and mask painted with white sigil-like symbols across the face, gripping their chest with a soiled hand, backlit by bright white haze with a dark blurred orb in the foreground.",
    src: publicImageUrl("music/ZJ7_5642.jpg"),
  },
  {
    key: "music/Opeth_3.jpg",
    width: 6048,
    height: 4024,
    alt: "Long-exposure black-and-white stage shot of a singer's blurred silhouette leaning into a mic stand, streaked light trails crossing the frame amid dense white haze.",
    src: publicImageUrl("music/Opeth_3.jpg"),
  },
  {
    key: "music/ZJ7_7250.jpg",
    width: 6048,
    height: 4024,
    alt: "Silhouetted singer on stage tilting head back, arm raised high gripping a chain-suspended microphone, blurred with streaks of blue haze light behind.",
    src: publicImageUrl("music/ZJ7_7250.jpg"),
  },
  {
    key: "music/ZJ7_5559.jpg",
    width: 6048,
    height: 4024,
    alt: "Low-angle shot of a bearded singer in a geometric-print jacket, eyes closed, gripping a mic with raised fist as stage lights streak diagonally overhead.",
    src: publicImageUrl("music/ZJ7_5559.jpg"),
  },
  {
    key: "music/P1033799.jpg",
    width: 5686,
    height: 3791,
    alt: "Black-and-white stage shot of four musicians spread across a wide stage flanked by two tall carved obelisk pillars, guitarist and vocalist at center mics, drummer backlit behind cymbals, crisscrossing light beams cutting through haze above a silhouetted crowd of raised phones in the foreground.",
    src: publicImageUrl("music/P1033799.jpg"),
  },
  {
    key: "music/ZJ7_5998.jpg",
    width: 6048,
    height: 4024,
    alt: "Male performer with a bird-and-rattlesnake tattoo on his forearm sings into a microphone, head tilted down, one arm outstretched, under vivid purple stage lighting with a chain necklace visible.",
    src: publicImageUrl("music/ZJ7_5998.jpg"),
  },
  {
    key: "music/RC_D_B-101443615.jpg",
    width: 5580,
    height: 3713,
    alt: "Black-and-white low-angle shot of a bearded, long-haired musician screaming into a mic stand while gripping an angled guitar neck, \"metal\" tattooed on his raised forearm, a single round stage light glowing over his shoulder.",
    src: publicImageUrl("music/RC_D_B-101443615.jpg"),
  },
];

import { getImageProps } from "next/image";
import type { CSSProperties } from "react";

// Full-bleed hero image with a separate portrait crop for phones (art
// direction via <picture>). On a portrait screen, `fill` + object-cover
// shows only a tall slice of a landscape photo — scaled up ~3.5x past the
// width-based variant the browser picks, so it looked visibly soft. Phones
// instead get a 2:3 crop framed on the subject (uploaded under mobile/<key>
// in the public bucket), which stays sharp at a fraction of the weight of
// serving the landscape original large enough to cover.
//
// `eager` replaces next/image's `preload` for above-the-fold heroes: a
// <link rel=preload> can't know which <source> a given screen will pick,
// so it would fetch the landscape image on phones too.
export default function HeroImage({
  src,
  mobileSrc,
  alt,
  quality,
  eager = false,
  objectPosition,
  className = "object-cover",
}: {
  src: string;
  mobileSrc?: string;
  alt: string;
  quality?: number;
  eager?: boolean;
  // Desktop framing only — the mobile crop is already framed on the subject.
  objectPosition?: string;
  className?: string;
}) {
  const common = {
    alt,
    fill: true,
    sizes: "100vw",
    quality,
    ...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {}),
  };
  const { props } = getImageProps({ ...common, src });
  const mobile = mobileSrc ? getImageProps({ ...common, src: mobileSrc }).props : null;

  const style: CSSProperties = { ...props.style, ...(objectPosition ? { objectPosition } : {}) };

  return (
    <picture>
      {mobile && <source media="(orientation: portrait)" srcSet={mobile.srcSet} sizes={mobile.sizes} />}
      {/* eslint-disable-next-line jsx-a11y/alt-text -- alt arrives via
          getImageProps' spread props; <picture> needs a raw <img> */}
      <img {...props} className={className} style={style} />
    </picture>
  );
}

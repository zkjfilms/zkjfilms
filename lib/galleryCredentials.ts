// TypeScript-side twin of scripts/gallery.mjs's generatePassword()/
// generatePin() — that script runs as plain Node and can't import this
// file, so this is kept in sync by hand. Same word list, same shapes.

import { randomInt } from "node:crypto";

const PASSWORD_WORDS = [
  "dune", "lantern", "willow", "harbor", "ember", "meadow", "cedar",
  "canyon", "ridge", "marble", "violet", "amber", "thistle", "granite",
  "coral", "birch", "quartz", "tundra", "orchid", "copper", "alpine",
  "cinder", "sable", "laurel",
];

export function generateGalleryPassword(): string {
  const words: string[] = [];
  while (words.length < 3) {
    const candidate = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
    if (!words.includes(candidate)) words.push(candidate);
  }
  const number = randomInt(10, 100);
  return `${words.join("-")}-${number}`;
}

export function generateGalleryPin(): string {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

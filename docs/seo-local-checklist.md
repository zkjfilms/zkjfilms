# zkjfilms.com local SEO checklist

Things only the site owner can do. The code changes are already in place. Nothing here promises a ranking. These steps make sure Google can find, understand and trust the site and the business.

## 1. Domain

- [ ] In Vercel, open the project, then Settings, then Domains. Set `www.zkjfilms.com` to redirect (308) to `zkjfilms.com`. Today `www` serves a duplicate copy of the site.
- [ ] Check it from Terminal with `curl -sI https://www.zkjfilms.com/`. The response should show a 308 pointing at `https://zkjfilms.com/`.

## 2. Booking settings (admin)

- [ ] In the admin, under Appointment Types, create a paid, active appointment type named exactly `Music & Performance Photography`. Until it exists, the `/music` page shows no starting price to Google (the Service Offer schema is left out).

## 3. Google Search Console

- [ ] Verify the `zkjfilms.com` domain property.
- [ ] Submit the sitemap: `https://zkjfilms.com/sitemap.xml`.
- [ ] Run Google's Rich Results Test on each page below. Confirm it detects the types listed. A page may also show warnings. Errors are what matter.
  - `/` : LocalBusiness
  - `/headshots` : Service + BreadcrumbList
  - `/faq` : FAQPage + BreadcrumbList
  - `/about` : Person + BreadcrumbList
  - `/podcast` : PodcastSeries + BreadcrumbList
- [ ] Use URL Inspection, then Request indexing, on the pages whose titles changed.
- [ ] Watch Page indexing and Performance for 4 to 6 weeks after the title changes. Compare impressions and clicks before and after.

## 4. Films page

- [ ] `/films` is hidden from Google (noindex) and left out of the sitemap until the first video is added. It switches on automatically once a film exists.
- [ ] After adding the first film, run the Rich Results Test on `/films`. It should show VideoObject.

## 5. Google Business Profile

- [ ] Primary category: Photographer. Secondary: Portrait studio, Boudoir photographer (if offered), Videographer.
- [ ] Services list matches the site: Headshots, Creative Portraits, Boudoir & Fine Art Nude, Music & Performance, Films.
- [ ] Hours match the site (Friday to Sunday, 10 to 5, open alternating weeks). Say the alternating-weeks part in the description.
- [ ] Add 20 or more photos. Never use boudoir images on the profile.
- [ ] Post monthly.
- [ ] Copy the review link (Get more reviews, then Share). Sending it to the developer unblocks the paused post-shoot review-request feature in this repo.

## 6. Reviews

- [ ] Ask every client within a week of delivering their photos.
- [ ] Reply to every review.
- [ ] Never offer incentives for reviews.

## 7. Citations (name, address, phone consistency)

- [ ] Use the exact name, address and phone from the `BUSINESS` block in `lib/seo.ts` on every listing: Bing Places, Apple Business Connect, Yelp, Facebook, your Instagram bio, the Columbia Chamber and CoMo directories, and The Knot / WeddingWire (only if you list portrait work there).
- [ ] Make sure every listing links to `https://zkjfilms.com`.

## 8. Ongoing

- [ ] Keep each page's title and description in `content/pages.ts`. `npm test` fails if one is too long or too short.
- [ ] Give every new gallery photo a unique, descriptive alt text. `npm test` checks this.
- [ ] Add films with `npm run video:create`. See section 4 for what happens next.

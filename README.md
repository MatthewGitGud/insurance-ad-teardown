# Canadian Insurance Ad Teardown

A one-page teardown of the Meta (Facebook and Instagram) ads that PolicyMe and its competitors run in Canada. It covers which ad angles everyone leans on, which nobody uses, and three creative briefs for the biggest gaps.

**Live site:** _add your GitHub Pages link here after publishing_

Built with plain HTML, CSS and JavaScript plus a few small Python scripts. No frameworks, no backend, no paid APIs. Everything on the page is generated from `data/ads.json`, so adding ads and rebuilding updates the whole page.

## What's on the page

| Section | What it shows |
|---|---|
| Key findings | 4–5 plain-language takeaways, each computed from the data and showing the count behind it |
| Gap map | Brands × ad angles, shaded by share of each brand's ads; empty cells are gaps. A second grid shows product × audience |
| Longest-running ads | The oldest active ads per brand, a likely-performer signal (Meta shows no spend for Canadian ads) |
| Ad gallery | Every ad with its hook, angle tags and days running, a link to the original, and filters for brand, angle, format and product |
| Creative briefs | Three test plans for the biggest gaps, labelled as hypotheses |
| How this was made | Sources, exclusions, limits, and how the process could run weekly |

## How it works

```
Meta Ad Library ──save page──▶ raw/<brand>/Ad Library.html
                                   │
          tools/extract_adlibrary.py   (facts: IDs, dates, post text, headline, CTA, media)
                                   ▼
                        data/extracted/<brand>.json
                                   │
          tools/fetch_media.py        (optional: video thumbnails, files, frames at 0–3s)
                                   │
          data/tags.json              (judgment tags: angle, audience, format, product…)
          data/video_openings.json    (on-screen text from each video's first 3 seconds)
          data/excluded.json          (ads left out on purpose, with the reason)
                                   │
          tools/build_ads.py          (merges everything, writes gallery images)
                                   ▼
                 data/ads.json + screenshots/  ──▶  index.html / app.js
```

Tags were added with AI assistance (Claude viewed each creative and read the copy) using the fixed taxonomy in `data/taxonomy.json`. Every tag was then reviewed by hand. Anything not visible in the ad is marked `unclear` with a note, never guessed.

## Project structure

```
index.html, styles.css, app.js   the page
data/
  ads.json            built by tools/build_ads.py (don't edit by hand)
  tags.json           your tags, one line per ad, keyed by Meta library ID
  taxonomy.json       allowed angles, audiences, products, formats, proof types
  briefs.json         the three creative briefs
  sources.json        which saved pages were collected, and when
  excluded.json       ads left out (not insurance, out of scope)
  manual_ads.json     ads added from single screenshots
  video_openings.json on-screen text from the first 3 seconds of videos
  extracted/          facts pulled from each saved page
screenshots/          one gallery image per ad (generated)
tools/                extract, fetch media, build
raw/                  saved pages, videos, frames (not published; see .gitignore)
```

## Updating the data

You need Python 3.10+. Pillow (`pip install pillow`) is optional; with it, the build resizes gallery images. ffmpeg is optional too; with it, the media script extracts video frames.

### Preview locally

The page loads its data with `fetch`, so it needs a local server rather than opening the file directly:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

### Add or refresh a brand from the Ad Library

1. Go to the [Meta Ad Library](https://www.facebook.com/ads/library/), set **Country: Canada**, **Ad category: All ads**, **Active ads**, and search for the brand (or open its advertiser page).
2. Scroll until no more results load, then save the page with your browser's "Save page as… (Complete)" into `raw/<brand>/`.
3. Extract the facts:
   ```bash
   python tools/extract_adlibrary.py "raw/<brand>/Ad Library.html" data/extracted/<brand>.json
   ```
4. Optionally, download video thumbnails, files and opening frames. Do this the same day, because the video links expire:
   ```bash
   python tools/fetch_media.py data/extracted/<brand>.json raw/<brand>
   ```
5. Add the brand to `data/sources.json` with the collection date.
6. Tag the new ads in `data/tags.json` (see below). Put anything off-topic in `data/excluded.json` with a reason.
7. Rebuild:
   ```bash
   python tools/build_ads.py
   ```
   Untagged ads still appear on the page, marked `unclear`, and the build lists them as warnings.

### Add a single ad from a screenshot

Save the screenshot in `raw/screenshots/<brand>-NN.png` and add an entry to `data/manual_ads.json`. Copy an existing entry's shape: facts from the screenshot plus the same tag fields. Then rebuild.

### Tagging rules

Each entry in `data/tags.json` has: `id`, `product`, `format`, `primary_angle`, `secondary_angles`, `audience`, `offer`, `proof_elements`, `creative_group`, `notes`, and optionally `language`, `headline` and `cta`. Allowed values are in `data/taxonomy.json`.

- **Primary angle:** what the creative leads with (the static's headline, or the video's first 3 seconds). Angles that only appear in the shared post-text boilerplate go in `secondary_angles`.
- **Audience:** who the creative's words or footage address. If the creative doesn't signal anyone, use the post text or link headline; otherwise `general`. Note it when the creative and post text disagree.
- **Format:** `video_talking_head` is a brand-produced presenter or expert, `video_ugc` is creator- or customer-style, `video_animated` has no person on camera, and `unclear` means the video wasn't reviewed.
- **Accuracy:** never invent copy, dates or performance. If it isn't visible, use `unclear` and say why in `notes`.

### Edit the briefs and findings

- Briefs live in `data/briefs.json`. Edit the text and the page updates.
- Key findings are computed in `app.js` (search for `findings`), so their numbers stay true when the data changes.

## Publish on GitHub Pages

1. Create a new **public** repository on GitHub (no README, so it starts empty).
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Canadian insurance ad teardown"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick **main** and **/ (root)**, then save.
4. After a minute or two the site is live at `https://<your-username>.github.io/<repo-name>/`.

To update the site later, rebuild the data, then run `git add .`, `git commit -m "Update ads"` and `git push`.

## Limits

- Meta doesn't show spend or results for Canadian commercial ads. How long an ad has run is a signal, not proof of performance.
- The Ad Library loads results as you scroll, so each brand's sample is the ads that had loaded when the page was saved, not necessarily every active ad.
- Some competitor videos were tagged from their post text only; they're marked "Video: not reviewed".

## Disclaimer

An independent portfolio project, not affiliated with or endorsed by PolicyMe or any brand shown. Ad creatives belong to their owners and are shown here for analysis and commentary.

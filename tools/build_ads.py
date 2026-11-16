"""Build data/ads.json (the file the page reads) from:

  data/sources.json         which saved pages were collected, and when
  data/extracted/*.json     facts pulled from each page (tools/extract_adlibrary.py)
  data/tags.json            judgment tags, one entry per library ID (edited by hand)
  data/video_openings.json  on-screen text from each video's first 3 seconds
  data/manual_ads.json      ads collected as single screenshots (raw/screenshots/),
                            facts and tags written by hand
  data/excluded.json        library IDs left out on purpose (e.g. not insurance), with reasons

It also writes one gallery image per ad to screenshots/<id>.jpg.

Usage (from the project root):
    python tools/build_ads.py

Ads without tags are still included, marked "unclear", and listed as warnings.
"""
import hashlib
import json
import os
import re
import shutil
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'screenshots')
THUMB_WIDTH = 360

try:
    from PIL import Image
except ImportError:  # Pillow is optional; images are copied unresized without it
    Image = None


def _load(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def _video_hook(opening):
    if not opening:
        return None
    parts = [opening['overlay']] if opening.get('overlay') else []
    for c in opening.get('captions', []):
        if c and (not parts or parts[-1] != c):
            parts.append(c)
    return ' / '.join(parts) or None


def _write_image(src, dest):
    if not os.path.exists(src):
        return False
    if Image is None:
        shutil.copyfile(src, dest)
        return True
    im = Image.open(src).convert('RGB')
    if im.width > THUMB_WIDTH:
        im = im.resize((THUMB_WIDTH, round(im.height * THUMB_WIDTH / im.width)), Image.LANCZOS)
    im.save(dest, 'JPEG', quality=82, optimize=True)
    return True


def _md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def build():
    tags = _load('data/tags.json')
    openings = _load('data/video_openings.json')['videos']
    excluded = ({e['library_id'] for e in _load('data/excluded.json')}
                if os.path.exists(os.path.join(ROOT, 'data', 'excluded.json')) else set())
    os.makedirs(SHOTS, exist_ok=True)
    ads, warnings, used_ids = [], [], {t['id'] for t in tags.values()}

    for src in _load('data/sources.json'):
        brand, raw_dir = src['brand'], os.path.join(ROOT, src['raw_dir'])
        collected = date.fromisoformat(src['collected'])
        cards = [c for c in _load(src['extracted'])['cards'] if c['library_id'] not in excluded]
        slug = brand.lower().replace(' ', '')
        next_n = 1 + max([int(i.rsplit('-', 1)[1]) for i in used_ids if i.startswith(slug + '-')] or [0])

        # identical video files across ad IDs
        video_hash = {}
        for c in cards:
            p = os.path.join(raw_dir, 'videos', f"{c['library_id']}.mp4")
            if c['media_type'] == 'video' and os.path.exists(p):
                video_hash[c['library_id']] = _md5(p)

        for c in cards:
            lid = c['library_id']
            t = tags.get(lid)
            if t is None:
                t = {'id': f'{slug}-{next_n:02d}', 'product': 'unclear', 'format': 'unclear',
                     'primary_angle': 'unclear', 'secondary_angles': [], 'audience': 'unclear', 'offer': None,
                     'proof_elements': [], 'creative_group': None, 'notes': 'Not tagged yet.'}
                next_n += 1
                warnings.append(f'untagged: {lid} -> {t["id"]}')

            end = date.fromisoformat(c['end_date']) if c.get('end_date') else collected
            start = date.fromisoformat(c['start_date'])
            opening = openings.get(lid)

            # partnership ads read "Creator with Brand" or "Brand with Creator"
            creator = None
            if c['with']:
                creator = c['page_name'] if c['with'].lower().startswith(brand.lower()) else c['with']
            notes = [t['notes']] if t.get('notes') else []
            if creator:
                notes.append(f'Partnership ad: {creator}.')
            if t.get('cta'):  # seen elsewhere, e.g. a screenshot of the single ad
                cta = t['cta']
            elif c['cta'] is None and c['ads_using_creative'] > 1:
                cta = 'unclear'
                notes.append(f"Headline and CTA not shown: Meta groups {c['ads_using_creative']} ads under this creative and text.")
            elif c['cta'] is None:
                cta = 'none'
                notes.append('No CTA button shown.')
            else:
                cta = c['cta']
            if opening and opening.get('partial'):
                notes.append('Video opening only partly legible in the sampled frames.')

            image_rel = f"screenshots/{t['id']}.jpg"
            img_src = (os.path.join(raw_dir, c['image_file']) if c['media_type'] == 'image' and c['image_file']
                       else os.path.join(raw_dir, 'video-thumbs', f'{lid}.jpg'))
            if not _write_image(img_src, os.path.join(ROOT, image_rel)):
                image_rel = None
                warnings.append(f'no image for {t["id"]} ({lid})')

            ads.append({
                'id': t['id'],
                'brand': brand,
                'library_id': lid,
                'ad_url': f'https://www.facebook.com/ads/library/?id={lid}',
                'start_date': c['start_date'],
                'days_running': (end - start).days,
                'product': t['product'],
                'format': t['format'],
                'primary_angle': t['primary_angle'],
                'secondary_angles': t['secondary_angles'],
                'audience': t['audience'],
                'hook': c['hook'],
                'offer': t['offer'],
                'cta': cta,
                'proof_elements': t['proof_elements'],
                'notes': ' '.join(notes),
                'video_hook': _video_hook(opening),
                'video_hook_partial': bool(opening and opening.get('partial')),
                'language': t.get('language', 'en'),
                'headline': t.get('headline') or c['headline'],
                'page_name': c['page_name'],
                'creator_partner': creator,
                'status': c['status'],
                'end_date': c.get('end_date'),
                'collected_date': src['collected'],
                'ads_using_creative': c['ads_using_creative'],
                'multiple_versions': c['multiple_versions'],
                'video_length': c['video_length'],
                'result_position': c['result_position'],
                'creative_group': t.get('creative_group'),
                'same_video_as': [],
                'image': image_rel,
                'primary_text': c['primary_text'],
                '_hash': video_hash.get(lid),
            })

    # Ads collected as single screenshots: facts and tags are written by hand.
    if os.path.exists(os.path.join(ROOT, 'data', 'manual_ads.json')):
        for m in _load('data/manual_ads.json'):
            collected = date.fromisoformat(m['collected_date'])
            end = date.fromisoformat(m['end_date']) if m.get('end_date') else collected
            image_rel = f"screenshots/{m['id']}.jpg"
            if not _write_image(os.path.join(ROOT, m['screenshot']), os.path.join(ROOT, image_rel)):
                image_rel = None
                warnings.append(f"no image for {m['id']}")
            ads.append({
                'id': m['id'], 'brand': m['brand'], 'library_id': m['library_id'],
                'ad_url': f"https://www.facebook.com/ads/library/?id={m['library_id']}",
                'start_date': m.get('start_date'),
                'days_running': (end - date.fromisoformat(m['start_date'])).days if m.get('start_date') else None,
                'product': m['product'], 'format': m['format'], 'primary_angle': m['primary_angle'],
                'secondary_angles': m['secondary_angles'], 'audience': m['audience'], 'hook': m['hook'],
                'offer': m.get('offer'), 'cta': m.get('cta') or 'unclear', 'proof_elements': m['proof_elements'],
                'notes': m.get('notes', ''), 'video_hook': m.get('video_hook'), 'video_hook_partial': False,
                'language': m.get('language', 'en'),
                'headline': m.get('headline'), 'page_name': m['brand'], 'creator_partner': None,
                'status': m.get('status'), 'end_date': m.get('end_date'), 'collected_date': m['collected_date'],
                'ads_using_creative': None, 'multiple_versions': None, 'video_length': None,
                'result_position': None, 'creative_group': m.get('creative_group'), 'same_video_as': [],
                'image': image_rel, 'primary_text': m.get('primary_text'), '_hash': None,
            })

    by_hash = {}
    for a in ads:
        if a['_hash']:
            by_hash.setdefault(a['_hash'], []).append(a['id'])
    for a in ads:
        h = a.pop('_hash')
        if h:
            a['same_video_as'] = [i for i in by_hash[h] if i != a['id']]

    # drop gallery images left over from ads that are no longer included
    current = {os.path.basename(a['image']) for a in ads if a['image']}
    for f in os.listdir(SHOTS):
        if re.fullmatch(r'[a-z]+-\d+\.jpg', f) and f not in current:
            os.remove(os.path.join(SHOTS, f))

    ads.sort(key=lambda a: a['id'])
    with open(os.path.join(ROOT, 'data', 'ads.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(ads, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(ads)} ads -> data/ads.json; images -> screenshots/')
    for w in warnings:
        print('WARNING', w)


if __name__ == '__main__':
    build()

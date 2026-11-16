"""Extract ad facts from a saved Meta Ad Library results page.

Usage:
    python tools/extract_adlibrary.py "raw/policyme/Ad Library.html" data/extracted/policyme.json

Save the page first: search the Ad Library, scroll until every result has
loaded, then save it with your browser's "Save page as... (Complete)".

Only facts that appear on the page are written: IDs, dates, post text,
headline, CTA, media links. No tagging happens here; tags live in
data/tags.json and are merged by tools/build_ads.py.
"""
import json
import os
import re
import sys
from datetime import datetime
from html.parser import HTMLParser

PLAYER_UI = re.compile(r'^\[ARIA (Video player|Play video|Play|Pause|Change Position|Settings|'
                       r'Enter fullscreen|Exit fullscreen|Change volume|Unmute|Mute)\]$')
TIMECODE = re.compile(r'^\d+:\d\d / (\d+:\d\d)$')
CARD_UI = {'Open Dropdown', 'See ad details', 'See summary details', 'Platforms',
           'This ad has multiple versions'}
FOOTER_START = 'System status'
DOMAIN = re.compile(r'^(WWW\.)?[A-Z0-9-]+(\.[A-Z0-9-]+)*\.[A-Z]{2,}$')
CTA_LABELS = {'get quote', 'learn more', 'see details', 'sign up', 'apply now', 'shop now', 'contact us',
              'book now', 'get offer', 'download', 'subscribe', 'send message', 'call now', 'see more',
              'get started', 'request time', 'watch more', 'order now', 'get directions'}


class _Flatten(HTMLParser):
    """Turn the page into lines of text plus [IMG]/[VIDEO]/[A] markers."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'):
            self._skip += 1
            return
        if tag == 'img':
            self.out.append(f"\n[IMG src={a.get('src', '')} alt={a.get('alt', '')!r}]\n")
        elif tag == 'video':
            self.out.append(f"\n[VIDEO poster={a.get('poster', '')} src={a.get('src', '')}]\n")
        elif tag == 'a' and a.get('href'):
            self.out.append(f"[A {a['href']}]")
        if a.get('aria-label'):
            self.out.append(f"\n[ARIA {a['aria-label']}]\n")
        if tag in ('div', 'br', 'p', 'li'):
            self.out.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            data = data.replace('​', '').strip()
            if data:
                self.out.append(' ' + data)


def _lines(html):
    p = _Flatten()
    p.feed(html)
    text = ''.join(p.out)
    return [l.strip() for l in text.split('\n') if l.strip()]


def _strip_links(s):
    return re.sub(r'\s*\[A [^\]]*\]\s*', ' ', s).strip()


def _parse_card(block):
    card = {'status': block[0], 'library_id': block[1].split(':', 1)[1].strip()}
    joined = '\n'.join(block)
    m = re.search(r'Started running on (\w{3} \d{1,2}, \d{4})', joined)
    card['start_date'] = datetime.strptime(m.group(1), '%b %d, %Y').strftime('%Y-%m-%d') if m else None
    m = re.search(r'(\w{3} \d{1,2}, \d{4}) - (\w{3} \d{1,2}, \d{4})', joined)
    card['end_date'] = datetime.strptime(m.group(2), '%b %d, %Y').strftime('%Y-%m-%d') if m else None
    card['multiple_versions'] = 'This ad has multiple versions' in joined
    m = re.search(r'(\d+) ads use this creative and text', joined)
    card['ads_using_creative'] = int(m.group(1)) if m else 1

    sp = block.index('Sponsored') if 'Sponsored' in block else None
    adv = block[sp - 1] if sp else ''
    names = [n.strip() for n in re.split(r'\[A [^\]]*\]', adv) if n.strip()]
    # "Creator with Brand" (creator's page) or "Brand with Creator" (brand's page)
    parts = [p.strip() for p in ' '.join(names).split(' with ')]
    card['page_name'] = parts[0] if parts else None
    card['with'] = parts[1] if len(parts) > 1 else None

    body = block[sp + 1:] if sp is not None else []
    media_at = next((i for i, l in enumerate(body) if l.startswith('[IMG') or l.startswith('[VIDEO')), len(body))
    card['primary_text'] = '\n'.join(_strip_links(l) for l in body[:media_at]
                                     if _strip_links(l) and not l.startswith('[ARIA'))
    card['hook'] = card['primary_text'].split('\n')[0] if card['primary_text'] else None

    rest = body[media_at:]
    imgs = [re.search(r"src=(.*?) alt=", l).group(1) for l in rest if l.startswith('[IMG')]
    vids = [l for l in rest if l.startswith('[VIDEO')]
    card['media_type'] = 'video' if vids else ('image' if imgs else None)
    card['image_file'] = imgs[0] if imgs and not vids else None
    card['image_count'] = len(imgs)
    card['image_files'] = imgs if not vids else []
    card['video_src'] = re.search(r' src=(\S*?)\]?$', vids[0]).group(1) if vids else None
    card['video_poster'] = re.search(r'poster=(\S*)', vids[0]).group(1) if vids else None
    tc = next((TIMECODE.match(l) for l in rest if TIMECODE.match(l)), None)
    card['video_length'] = tc.group(1) if tc else None

    link = [_strip_links(l) for l in rest
            if not l.startswith(('[IMG', '[VIDEO')) and not PLAYER_UI.match(l) and not TIMECODE.match(l)]
    link = [l for l in link if l and l not in CARD_UI]
    # The link section is [domain] [headline] [description] [CTA button]; any part can be missing.
    card['link_domain'] = link.pop(0) if link and DOMAIN.match(link[0]) else None
    card['cta'] = link.pop() if link and link[-1].lower() in CTA_LABELS else None
    card['headline'] = link[0] if link else None
    card['link_description'] = ' '.join(link[1:]) or None
    return card


def extract(html_path):
    html = open(html_path, encoding='utf-8').read()
    m = re.search(r'saved from url=\(\d+\)(\S+)', html)
    lines = _lines(html)
    if FOOTER_START in lines:
        lines = lines[:len(lines) - 1 - lines[::-1].index(FOOTER_START)]
    starts = [i - 1 for i, l in enumerate(lines)
              if l.startswith('Library ID:') and i > 0 and lines[i - 1] in ('Active', 'Inactive')]
    cards = []
    for n, s in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        card = _parse_card(lines[s:end])
        card['result_position'] = n + 1
        cards.append(card)
    total = re.search(r'~?([\d,]+) results', '\n'.join(lines[:400]))
    return {
        'source_url': m.group(1) if m else None,
        'source_file': os.path.basename(html_path),
        'results_reported': total.group(0) if total else None,
        'cards_loaded': len(cards),
        'cards': cards,
    }


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    data = extract(sys.argv[1])
    os.makedirs(os.path.dirname(sys.argv[2]) or '.', exist_ok=True)
    with open(sys.argv[2], 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{data['cards_loaded']} cards extracted ({data['results_reported']} reported by the page) -> {sys.argv[2]}")

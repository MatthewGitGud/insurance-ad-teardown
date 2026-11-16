"""Download video thumbnails and files for the ads in an extracted JSON, then
pull frames at 0, 1, 2 and 3 seconds so the opening can be read.

Usage:
    python tools/fetch_media.py data/extracted/policyme.json raw/policyme

Run it soon after saving the Ad Library page: Facebook's media links expire
after a few days. Static images don't need this step; the browser already
saved them next to the page. Frame extraction needs ffmpeg on PATH and is
skipped if it isn't installed. Files that already exist are left alone.
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HEADERS = {'User-Agent': 'Mozilla/5.0'}
MAGIC = {'jpg': [b'\xff\xd8\xff'], 'mp4': [b'ftyp']}


def _download(url, dest, kind):
    if os.path.exists(dest):
        return 'kept'
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    head = data[:16]
    if not any(m in head for m in MAGIC[kind]):
        raise ValueError(f'not a {kind} file')
    with open(dest, 'wb') as f:
        f.write(data)
    return 'downloaded'


def main(extracted_path, raw_dir):
    cards = [c for c in json.load(open(extracted_path, encoding='utf-8'))['cards'] if c['media_type'] == 'video']
    dirs = {k: os.path.join(raw_dir, k) for k in ('video-thumbs', 'videos', 'video-frames')}
    for d in dirs.values():
        os.makedirs(d, exist_ok=True)
    ffmpeg = shutil.which('ffmpeg')
    failed = []
    for c in cards:
        lid = c['library_id']
        try:
            _download(c['video_poster'], os.path.join(dirs['video-thumbs'], f'{lid}.jpg'), 'jpg')
            _download(c['video_src'], os.path.join(dirs['videos'], f'{lid}.mp4'), 'mp4')
        except Exception as e:  # expired link, network error, wrong content
            failed.append((lid, str(e)))
            continue
        if ffmpeg:
            for t in (0, 1, 2, 3):
                out = os.path.join(dirs['video-frames'], f'{lid}_t{t}.jpg')
                if not os.path.exists(out):
                    subprocess.run([ffmpeg, '-v', 'error', '-y', '-ss', str(t), '-i',
                                    os.path.join(dirs['videos'], f'{lid}.mp4'), '-frames:v', '1', '-q:v', '3', out],
                                   check=False, stdin=subprocess.DEVNULL)
    print(f'{len(cards) - len(failed)}/{len(cards)} videos fetched into {raw_dir}'
          + ('' if ffmpeg else ' (ffmpeg not found: no frames extracted)'))
    for lid, err in failed:
        print(f'  FAILED {lid}: {err}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

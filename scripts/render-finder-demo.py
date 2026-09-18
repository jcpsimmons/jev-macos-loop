"""Export a window recording with a timer derived from the verified run trace.
Requires Pillow and ffmpeg. Never accelerate or cut the timed task.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capture', type=Path)
parser.add_argument('trace', type=Path)
parser.add_argument('--inspection-start', type=float, required=True)
parser.add_argument('--inspection-duration', type=float, default=6)
parser.add_argument('--output', type=Path, default=Path('docs/media/jev-finder-demo'))
args = parser.parse_args()
metadata = json.loads((args.capture / 'metadata.json').read_text())
trace = json.loads(args.trace.read_text())
assert trace['passed'] and trace['totalFiles'] == 9 and all(f['passed'] for f in trace['actual'])
assert len(metadata['recorders']) == 1 and metadata['recorders'][0]['type'] == 'window'
session = metadata['recorders'][0]['sessions'][0]
source = args.capture / session['outputFilename']
start = (trace['startedAt'] - session['unixStartMs']) / 1000
elapsed = trace['verifiedElapsedMs'] / 1000
# Keep the entire timed task and a short verified hold, followed by result inspection.
task_end = math.ceil(start + elapsed + 1)
assert 0 <= start and task_end <= args.inspection_start
assert args.inspection_start + args.inspection_duration <= session['durationMs'] / 1000
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(source)]))
assert all(s['codec_type'] != 'audio' for s in probe['streams'])
video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
width = video['width']
# Only unused rows and the status bar are cropped from this list-view capture.
crop_height = round(width * 700 / 1840 / 2) * 2
footer_height = round(width * 190 / 1840 / 2) * 2
scale = width / 1840
font_root = Path('/System/Library/Fonts')
regular = lambda size: ImageFont.truetype(str(font_root / 'Supplemental/Arial.ttf'), round(size * scale))
bold = ImageFont.truetype(str(font_root / 'Supplemental/Arial Bold.ttf'), round(44 * scale))
mono = ImageFont.truetype(str(font_root / 'SFNSMono.ttf'), round(66 * scale))
duration = task_end + args.inspection_duration
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='jev-footer-') as temporary:
    tmp = Path(temporary)
    for frame in range(math.ceil(duration * 30)):
        t = frame / 30
        verified = t >= start + elapsed
        inspection = t >= task_end
        image = Image.new('RGB', (width, footer_height), '#111820')
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, width, 3 * scale), fill='#5FE3B5')
        x = 40 * scale
        draw.text((x, 22 * scale), 'JEV SORTS FINDER' if not verified else '9 / 9 FILES VERIFIED', font=bold, fill='#F5F8FC')
        sub = 'Real-time native macOS automation' if not verified else 'Correct folders. File contents unchanged.'
        if inspection:
            sub = 'Result inspection after the timed run'
        draw.text((x, 79 * scale), sub, font=regular(29), fill='#BCC8D6')
        draw.text((x, 133 * scale), 'invoice_ > Invoices     receipt_ > Receipts     report_ > Reports', font=regular(28), fill='#8FA5B7')
        timer = f'{min(max(t-start, 0), elapsed):05.2f}s'
        draw.text((width - 40 * scale, 29 * scale), timer, font=mono, fill='#5FE3B5', anchor='ra')
        draw.text((width - 40 * scale, 117 * scale), 'VERIFIED' if verified else 'ELAPSED', font=regular(26), fill='#BCC8D6', anchor='ra')
        image.save(tmp / f'{frame:04d}.png')
    graph = (
        f'[0:v]split=2[a][b];'
        f'[a]trim=start=0:end={task_end},setpts=PTS-STARTPTS,fps=30,crop={width}:{crop_height}:0:0[a1];'
        f'[b]trim=start={args.inspection_start}:end={args.inspection_start+args.inspection_duration},setpts=PTS-STARTPTS,fps=30,crop={width}:{crop_height}:0:0[b1];'
        '[a1][b1]concat=n=2:v=1:a=0[screen];[screen][1:v]vstack=inputs=2[out]'
    )
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-framerate', '30', '-i', str(tmp / '%04d.png'), '-filter_complex', graph, '-map', '[out]', '-an', '-t', str(duration), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(args.output.with_suffix('.mp4'))], check=True)
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(args.output.with_suffix('.mp4')), '-filter_complex', 'fps=15,scale=920:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', str(args.output.with_suffix('.gif'))], check=True)
evidence = {
    'recordedAt': trace['startedAt'], 'provider': trace['provider'], 'passed': True,
    'verifiedElapsedMs': trace['verifiedElapsedMs'], 'timerOffsetSeconds': start,
    'recorder': 'Screen Studio 3.7.5 bundled polyrecorder 2.7.0',
    'captureScope': 'One Finder window containing only fictional test files; sidebar and path bar hidden',
    'sourceWidth': width, 'sourceHeight': video['height'], 'cropHeight': crop_height,
    'audioStreams': 0, 'camera': False, 'keyboardCapture': False, 'speedMultiplier': 1,
    'timer': 'Composited from recorded start timestamp and independently verified elapsed duration; warmup excluded',
    'segmentsSeconds': [[0, task_end], [args.inspection_start, args.inspection_start+args.inspection_duration]],
    'editing': 'Uninterrupted normal-speed timed run; idle gap after verification removed before operator-expanded folder inspection',
    'exports': [{'file': str(args.output.with_suffix(ext)), 'sha256': hashlib.sha256(args.output.with_suffix(ext).read_bytes()).hexdigest()} for ext in ['.mp4', '.gif']],
    'sourceHashes': [{'file': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(args.capture.iterdir()) if p.suffix in ['.m3u8', '.mp4', '.m4s', '.json']],
}
args.output.with_suffix('.json').write_text(json.dumps(evidence, indent=2) + '\n')
print(json.dumps({'durationSeconds': duration, 'verifiedElapsedSeconds': elapsed, 'output': str(args.output)}))

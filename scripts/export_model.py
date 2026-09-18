"""Convert the pinned official OmniParser detector; no captioning model is used."""
import hashlib
from pathlib import Path
from urllib.request import urlretrieve
from ultralytics import YOLO

root = Path(__file__).resolve().parents[1] / "models"
root.mkdir(exist_ok=True)
weights = root / "omniparser.pt"
url = "https://huggingface.co/microsoft/OmniParser-v2.0/resolve/8d0c5ee/icon_detect/model.pt"
expected = "dab3d4351ad00b035db829909a4db98354d5a90f6990e4ac00222a9a95d4bf57"
if not weights.exists():
    urlretrieve(url, weights)
assert hashlib.sha256(weights.read_bytes()).hexdigest() == expected, "Weight checksum mismatch"
YOLO(str(weights)).export(format="coreml", imgsz=640, nms=True, half=True, device="cpu")

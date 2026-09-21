"""Generates the raw game art with the local ComfyUI (Krea-2 Turbo GGUF).

    python tools/gen_assets.py              # all assets, 2 variants each
    python tools/gen_assets.py player boss  # only these

Needs a running ComfyUI on 127.0.0.1:8188. Raw images land in art/raw/<name>_<seed>.png,
tools/key_assets.py turns the chosen ones into the sprites under public/assets/.
"""
import json, sys, time, urllib.request, urllib.parse
from pathlib import Path

HOST = "http://127.0.0.1:8188"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
SEEDS = [11, 23]

GREEN = ("highly detailed sci-fi video game sprite, polished 3D render, sharp clean silhouette, centered, "
         "the whole object fully visible with margin around it, isolated on a flat uniform pure bright green "
         "chroma key background, no shadow, no text, no frame")
BLACK = "deep black empty space background, no text, no frame"

ASSETS = {
    # sprites (green screen -> keyed)
    "player": ("a sleek white and silver futuristic space fighter with swept wings, blue glowing engine exhaust at the "
               "back, pointed nose facing to the right, exact side view profile", GREEN, 1024, 1024),
    "drone": ("a small round white armored satellite drone pod with a glowing blue core and two short cannons, "
              "side view", GREEN, 1024, 1024),
    "enemy_blue": ("a compact symmetrical alien attack drone made of white hexagonal armor plates with a glowing blue "
                   "energy core in the center and small blue thruster lights around it, front view", GREEN, 1024, 1024),
    "enemy_orange": ("a compact symmetrical alien attack drone made of white hexagonal armor plates with a glowing "
                     "orange red energy core in the center and small orange thruster lights around it, front view",
                     GREEN, 1024, 1024),
    "enemy_fighter": ("a dark gunmetal alien interceptor spaceship with sharp angular blade wings and red glowing "
                      "lights, nose pointing to the left, exact side view profile", GREEN, 1024, 1024),
    "cannon": ("a long horizontal cylindrical space station cannon module, grey metal segments with glowing blue "
               "rings and a blue glowing muzzle, pointing to the right, exact side view", GREEN, 1536, 768),
    "boss": ("a huge menacing alien battleship mothership, dark armored metal hull with a big glowing orange reactor "
             "core and many turrets, bow facing to the left, exact side view profile", GREEN, 1536, 1024),
    "asteroid": ("a single rough dark grey rocky asteroid with craters, lit from the left", GREEN, 1024, 1024),
    "powerup": ("a small glowing futuristic power-up capsule, chrome metal pod with a bright cyan energy crystal "
                "inside", GREEN, 1024, 1024),
    # backdrops (black -> drawn additively / with a disc mask)
    "planet": ("a large blue earth-like planet seen from space, thin glowing blue atmosphere rim, dark night side, "
               "the entire planet visible and centered, " + "photorealistic", BLACK, 1024, 1024),
    "galaxy": ("a beautiful spiral galaxy with a bright pink orange core and blue violet spiral arms, tilted, "
               "photorealistic astrophotography, centered", BLACK, 1024, 1024),
    "nebula": ("a wispy glowing blue and violet space nebula cloud with a few bright stars, "
               "photorealistic astrophotography", BLACK, 1536, 864),
    "explosion": ("a single bright fiery explosion burst, orange and yellow fireball with glowing sparks and "
                  "smoke, centered", BLACK, 1024, 1024),
}


def workflow(text, w, h, seed, prefix):
    return {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "krea2_turbo_bf16-Q4_0.gguf"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors",
                                                      "type": "krea2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "Qwen_Image-VAE.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": text}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
                                                    "latent_image": ["6", 0], "seed": seed, "steps": 8, "cfg": 1.0,
                                                    "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def post(path, body):
    req = urllib.request.Request(HOST + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def get(path):
    return urllib.request.urlopen(HOST + path).read()


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(ASSETS)
    jobs = []
    for name in names:
        subject, style, w, h = ASSETS[name]
        for seed in SEEDS:
            pid = post("/prompt", {"prompt": workflow(subject + ", " + style, w, h, seed, "hypersense/" + name)})["prompt_id"]
            jobs.append((name, seed, pid))
    print(f"{len(jobs)} jobs queued", flush=True)
    for name, seed, pid in jobs:
        while True:
            hist = json.loads(get("/history/" + pid)).get(pid)
            if hist and hist.get("outputs"):
                break
            if hist and hist.get("status", {}).get("status_str") == "error":
                print(f"FAILED {name} {seed}", flush=True)
                hist = None
                break
            time.sleep(1)
        if not hist:
            continue
        img = hist["outputs"]["9"]["images"][0]
        q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img["subfolder"], "type": img["type"]})
        (RAW / f"{name}_{seed}.png").write_bytes(get("/view?" + q))
        print(f"ok {name}_{seed}", flush=True)


if __name__ == "__main__":
    main()

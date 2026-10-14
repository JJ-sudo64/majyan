"""雀神の効果音（ガチャ演出・メニューのボタン）を合成し、音量をそろえて mp3 に書き出す。

    python scripts/synth-sfx.py            packages/web/public/sfx/ の gacha-*.mp3・ui-*.mp3 を作り直す

numpy・scipy と、PATH 上の ffmpeg が要る。乱数の種を固定しているので、何度流しても同じ音になる。

琴（Karplus-Strong）・和太鼓・鐘（非整数倍音）・金管風の和音（加算合成）・ノイズのうねりを
重ね、合成した残響に通す。すべて D の長調（ヨナ抜き: D E F# A B）でそろえる。
"""
import os
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, istft, lfilter, sosfilt

SR = 48000
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "packages", "web", "public", "sfx")
OUT = tempfile.mkdtemp(prefix="synth-sfx-")
rng = np.random.default_rng(7)


def t_of(n):
    return np.arange(n) / SR


def secs(x):
    return int(round(x * SR))


def note(name):
    """'D4' などを周波数に。"""
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[pitch] + 12 * (octave - 4)) / 12)


def stereo(x, pan=0.0):
    """モノラルを左右に置く（-1=左, 1=右）。"""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def place(buf, sig, at, fade=True):
    """buf（2×N）の at 秒の位置に sig（2×M または M）を足す。"""
    if sig.ndim == 1:
        sig = stereo(sig)
    # 音の終わりをなめらかに消す（途中で切ると「プツッ」と鳴る）。
    if fade:
        m = sig.shape[1]
        f = max(1, int(m * 0.35))
        sig = sig.copy()
        sig[:, m - f :] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 2
    i = secs(at)
    if i >= buf.shape[1]:
        return
    m = min(sig.shape[1], buf.shape[1] - i)
    buf[:, i : i + m] += sig[:, :m]


def env_exp(n, decay, attack=0.002):
    t = t_of(n)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / decay)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


# ---------------------------------------------------------------- 楽器


def koto(freq, dur=1.8, bright=0.6, level=1.0):
    """琴: Karplus-Strong の撥弦。撥く位置の櫛形フィルタで琴らしい鼻にかかった響きにする。"""
    n = secs(dur)
    period = SR / freq
    N = int(period)
    frac = period - N
    exc = rng.uniform(-1, 1, N)
    exc = lp(exc, 1500 + 7000 * bright)
    # 弦の端に近い所を撥く（倍音の谷を作る）。
    k = max(1, int(N * 0.13))
    exc = exc - np.concatenate([np.zeros(k), exc[:-k]])
    x = np.zeros(n)
    x[:N] = exc
    g = 0.996 ** (440 / freq) ** 0.5
    a = np.zeros(N + 2)
    a[0] = 1
    a[N] = -g * (1 - frac) * 0.5 - g * 0.5 * (1 - frac)
    a[N + 1] = -g * 0.5 * frac - g * 0.5 * frac + 0
    # 平均フィルタ (y[n-N] + y[n-N-1]) / 2 を分数遅延込みで近似。
    a[N] = -g * (0.5 + 0.5 * (1 - frac))
    a[N + 1] = -g * (0.5 * frac)
    y = lfilter([1.0], a, x)
    y *= np.exp(-t_of(n) / (dur * 0.45))
    y = hp(y, 60)
    return level * y / (np.max(np.abs(y)) + 1e-9)


def bell(freq, dur=2.5, level=1.0, bright=1.0):
    """鐘・鈴: 非整数倍音を足し合わせる。高い倍音ほど早く消える。"""
    n = secs(dur)
    t = t_of(n)
    partials = [(0.5, 0.35, 1.0), (1.0, 1.0, 1.0), (2.0, 0.55, 0.6), (2.76, 0.45, 0.45), (5.4, 0.28 * bright, 0.25), (8.93, 0.16 * bright, 0.15)]
    y = np.zeros(n)
    for ratio, amp, dec in partials:
        f = freq * ratio
        if f > SR / 2.2:
            continue
        y += amp * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / (dur * 0.4 * dec))
    y *= np.clip(t / 0.002, 0, 1)
    return level * y / (np.max(np.abs(y)) + 1e-9)


def glint(freq, dur=0.25, level=1.0):
    """きらめきの粒（ごく短い高い鈴）。"""
    n = secs(dur)
    t = t_of(n)
    y = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t / 0.03)
    return level * y * env_exp(n, dur * 0.25, 0.001)


def taiko(dur=1.2, level=1.0, pitch=1.0):
    """和太鼓: 音程が下がる胴鳴り＋皮を打つ音＋低いうなり。"""
    n = secs(dur)
    t = t_of(n)
    f = (60 + 110 * np.exp(-t / 0.045)) * pitch
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.42)
    over = 0.35 * np.sin(2 * np.pi * np.cumsum(f * 1.58) / SR) * np.exp(-t / 0.18)
    slap = lp(rng.uniform(-1, 1, n), 1800) * np.exp(-t / 0.025) * 0.9
    y = np.tanh(1.6 * (body + over + slap))
    return level * y / (np.max(np.abs(y)) + 1e-9)


def sub_boom(dur=1.4, level=1.0, start=110, end=34):
    n = secs(dur)
    t = t_of(n)
    f = end + (start - end) * np.exp(-t / 0.12)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur * 0.35)) * np.clip(t / 0.004, 0, 1)
    return level * y


def crash(dur=2.4, level=1.0, bright=1.0):
    """シンバル: 高域ノイズと金属的な非整数倍音。左右で少し違う音にする。"""
    n = secs(dur)
    t = t_of(n)
    out = []
    for _ in range(2):
        nz = hp(rng.uniform(-1, 1, n), 3500 if bright >= 1 else 2500, 2)
        metal = np.zeros(n)
        for f in rng.uniform(3000, 11000, 24):
            metal += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
        y = (nz + 0.06 * metal) * (np.exp(-t / (dur * 0.32)) * 0.85 + 0.15 * np.exp(-t / 0.05))
        y *= np.clip(t / 0.003, 0, 1)
        out.append(y)
    s = np.stack(out)
    return level * s / (np.max(np.abs(s)) + 1e-9)


def additive(freqs, dur, attack, release, cutoff_from, cutoff_to, level=1.0, detune=0.004, voices=3, formants=None, vibrato=0.0, glide=None):
    """加算合成のこぎり波（金管・合唱の元）。cutoff は時間とともに動く倍音の上限（Hz）。
    formants を渡すと母音の山を付けて「アー」という声に近づける。"""
    n = secs(dur)
    t = t_of(n)
    cut = cutoff_from * (cutoff_to / cutoff_from) ** np.clip(t / max(attack * 1.5, 1e-3), 0, 1)
    amp_env = np.clip(t / attack, 0, 1) ** 1.5 * np.clip((dur - t) / release, 0, 1)
    vib = 1 + vibrato * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.25) / 0.5, 0, 1)
    if glide is not None:
        vib = vib * glide
    top = 1.0 if glide is None else float(np.max(glide))
    out = np.zeros((2, n))
    for f0 in freqs:
        for v in range(voices):
            d = 1 + detune * (v - (voices - 1) / 2)
            pan = (v - (voices - 1) / 2) * 0.6 / max(1, voices - 1)
            sig = np.zeros(n)
            phase0 = rng.uniform(0, 6.28)
            k = 1
            while f0 * d * k * top < min(16000, SR / 2.2):
                fk = f0 * d * k
                w = 1.0 / k
                w_t = 1 / (1 + np.exp((fk * (vib if glide is not None else 1) - cut) / (0.18 * cut + 1)))
                if formants:
                    w *= 0.25 + sum(g * np.exp(-((fk - fc) / bw) ** 2) for fc, bw, g in formants)
                sig += w * w_t * np.sin(2 * np.pi * fk * np.cumsum(vib) / SR + phase0 * k)
                k += 1
            out += stereo(sig, pan)
    out *= amp_env
    return level * out / (np.max(np.abs(out)) + 1e-9)


def noise_sweep(dur, f_from, f_to, width=0.5, curve=2.0, level=1.0):
    """帯域が動くノイズ（せり上がる「シュワー」）。STFTの上で帯域の山を動かして作る。"""
    nper = 1024
    hop = nper // 4
    frames = secs(dur) // hop + 2
    freqs = np.fft.rfftfreq(nper, 1 / SR)
    out = []
    for _ in range(2):
        Z = np.zeros((len(freqs), frames), complex)
        for j in range(frames):
            p = j / (frames - 1)
            fc = f_from * (f_to / f_from) ** p
            mask = np.exp(-((np.log(freqs + 1) - np.log(fc)) / width) ** 2)
            Z[:, j] = mask * np.exp(1j * rng.uniform(0, 6.28, len(freqs))) * (p**curve)
        _, x = istft(Z, fs=SR, nperseg=nper, noverlap=nper - hop)
        out.append(x[: secs(dur)])
    s = np.stack(out)
    return level * s / (np.max(np.abs(s)) + 1e-9)


def reverb(x, rt=2.0, mix=0.3, pre=0.012, damp=6000):
    """合成した残響（左右で別のノイズの減衰、時間がたつほど高音が落ちる）。"""
    n = secs(rt * 1.2)
    t = t_of(n)
    irs = []
    for _ in range(2):
        nz = rng.normal(0, 1, n) * np.exp(-6.9 * t / rt)
        early = lp(nz, damp)
        late = lp(nz, damp * 0.35)
        w = np.clip(t / (rt * 0.5), 0, 1)
        ir = early * (1 - w) + late * w
        ir = np.concatenate([np.zeros(secs(pre)), ir])
        irs.append(ir / np.sqrt(np.sum(ir**2)))
    wet = np.stack([fftconvolve(x[0], irs[0]), fftconvolve(x[1], irs[1])])
    dry = np.pad(x, ((0, 0), (0, wet.shape[1] - x.shape[1])))
    return dry * (1 - mix) + wet * mix * 0.9


def finish(buf, name, peak_db=-1.5, tail_fade=0.08, length=None):
    """軽く飽和させ、長さをそろえ、最大音量を合わせて書き出す。"""
    y = np.tanh(buf * 1.1) / np.tanh(1.1)
    if length is not None:
        y = y[:, : secs(length)]
    # 末尾の無音を切ってから短くフェードアウト。
    energy = np.max(np.abs(y), axis=0)
    last = np.nonzero(energy > 10 ** (-70 / 20) * np.max(energy))[0]
    if length is None and len(last):
        y = y[:, : min(y.shape[1], last[-1] + secs(0.05))]
    f = min(secs(tail_fade), y.shape[1])
    y[:, -f:] *= np.linspace(1, 0, f) ** 2
    y = y / (np.max(np.abs(y)) + 1e-9) * 10 ** (peak_db / 20)
    pcm = (y.T * 32767).astype(np.int16)
    import wave

    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{name}: {y.shape[1] / SR:.2f}s")


YO = ["D", "E", "F#", "A", "B"]  # ヨナ抜き長音階


def yo_scale(start_octave, count, start_index=0):
    out = []
    i = start_index
    while len(out) < count:
        out.append(f"{YO[i % 5]}{start_octave + i // 5}")
        i += 1
    return out


def koto_gliss(buf, at, notes, gap=0.045, level=0.5, dur=1.6, pan_spread=0.5):
    for i, nm in enumerate(notes):
        pan = -pan_spread + 2 * pan_spread * i / max(1, len(notes) - 1)
        place(buf, stereo(koto(note(nm), dur, bright=0.7, level=level * (0.8 + 0.2 * i / len(notes))), pan), at + i * gap)


def sparkles(buf, start, end, count, level=0.12, density_curve=1.0, low=2400, high=7000):
    for i in range(count):
        u = (i + rng.uniform(0, 1)) / count
        at = start + (end - start) * u ** (1 / density_curve)
        f = rng.uniform(low, high)
        place(buf, stereo(glint(f, 0.3, level * rng.uniform(0.5, 1.0)), rng.uniform(-0.9, 0.9)), at)


# ---------------------------------------------------------------- ガチャ

CHARGE = {1: 1.3, 2: 1.8, 3: 2.6}

for tier, L in CHARGE.items():
    buf = np.zeros((2, secs(L + 0.3)))
    # 低い和音がうなりながら上がる（D2 A2 D3 → 7半音上へ）。
    glide = 2 ** (7 / 12 * np.clip(t_of(secs(L)) / L, 0, 1) ** 1.6)
    drone = additive([note("D2"), note("A2"), note("D3")], L, L * 0.85, 0.05, 250, 3800 + 1200 * tier, level=0.5, detune=0.006, voices=3, glide=glide)
    drone = drone * np.linspace(0.3, 1, drone.shape[1]) ** 1.5
    place(buf, drone, 0, fade=False)
    place(buf, noise_sweep(L, 300, 4500 + 1500 * tier, width=0.45, curve=2.4, level=0.32), 0, fade=False)
    sparkles(buf, L * 0.15, L, int(10 + 8 * tier * L), level=0.09, density_curve=2.2)
    if tier == 3:
        rumble = lp(rng.normal(0, 1, secs(L)), 90, 4) * np.linspace(0, 1, secs(L)) ** 1.2
        place(buf, stereo(rumble / np.max(np.abs(rumble)) * 0.55), 0, fade=False)
        choir = additive([note("D4"), note("F#4"), note("A4"), note("D5")], L, L * 0.9, 0.05, 900, 3200, level=0.32, voices=3, formants=[(700, 180, 1.0), (1220, 220, 0.6), (2600, 300, 0.35)], vibrato=0.006)
        place(buf, choir, 0, fade=False)
    # 最後の0.7秒で、逆再生したシンバルが吸い込まれる。
    rev = crash(0.9, 0.42 + 0.06 * tier)[:, ::-1]
    place(buf, rev, L - rev.shape[1] / SR, fade=False)
    buf = reverb(buf, rt=1.6, mix=0.22)
    finish(buf, f"gacha-charge-{tier}", peak_db=-3.0 - (3 - tier) * 0.8, length=L, tail_fade=0.03)

for tier in (2, 3):
    buf = np.zeros((2, secs(3.2)))
    if tier == 2:
        koto_gliss(buf, 0, yo_scale(5, 6, 0), gap=0.04, level=0.45)
        for nm in ("F#6", "A6", "D7"):
            place(buf, stereo(bell(note(nm), 1.6, 0.22), rng.uniform(-0.4, 0.4)), 0.24)
        sparkles(buf, 0.2, 0.9, 10, level=0.08, low=3500, high=8000)
    else:
        koto_gliss(buf, 0, yo_scale(4, 10, 0), gap=0.038, level=0.5)
        place(buf, stereo(bell(note("D3"), 3.0, 0.5, bright=0.5)), 0.36)
        for nm in ("D6", "F#6", "A6", "D7"):
            place(buf, stereo(bell(note(nm), 2.0, 0.22), rng.uniform(-0.5, 0.5)), 0.38)
        place(buf, sub_boom(1.0, 0.35, 80, 40), 0.36)
        sparkles(buf, 0.3, 1.4, 22, level=0.09, low=3000, high=8500)
    buf = reverb(buf, rt=2.2, mix=0.32)
    finish(buf, f"gacha-upgrade-{tier}", peak_db=-4.0)

for tier in (1, 2, 3):
    buf = np.zeros((2, secs(4.0)))
    # 衝撃: 打つ瞬間の高い「パシッ」＋低い「ドン」。
    click = hp(rng.uniform(-1, 1, secs(0.03)), 2000) * np.exp(-t_of(secs(0.03)) / 0.006)
    place(buf, stereo(click * 0.6), 0)
    place(buf, sub_boom(1.2 + 0.4 * tier, 0.5 + 0.2 * tier), 0)
    chord = {1: ["A5", "D6", "F#6"], 2: ["D5", "A5", "D6", "F#6"], 3: ["D4", "A4", "D5", "F#5", "A5", "D6"]}[tier]
    if tier >= 2:
        place(buf, taiko(1.4, 0.75 + 0.1 * tier, 1.0 if tier == 2 else 0.85), 0)
        place(buf, crash(1.6 + 0.6 * tier, 0.35 + 0.1 * tier), 0.005)
        brass = additive([note(n) for n in chord[: 3 + tier]], 1.4 + 0.4 * tier, 0.04, 0.9, 600, 5200, level=0.38 + 0.06 * tier, voices=3, detune=0.005)
        place(buf, brass, 0.01)
    else:
        puff = lp(rng.uniform(-1, 1, secs(0.4)), 2500) * np.exp(-t_of(secs(0.4)) / 0.08)
        place(buf, stereo(puff * 0.3), 0)
    for i, nm in enumerate(chord):
        place(buf, stereo(bell(note(nm) * (2 if tier == 1 else 1) if note(nm) < 1200 else note(nm), 2.4, 0.16), -0.5 + i / len(chord)), 0.01)
    sparkles(buf, 0.02, 1.2 + 0.4 * tier, 14 + 10 * tier, level=0.1, density_curve=0.5)
    if tier == 3:
        place(buf, taiko(1.6, 0.8, 0.7), 0.0)
        place(buf, sub_boom(2.4, 0.8, 90, 28), 0.0)
    buf = reverb(buf, rt=2.0 + 0.4 * tier, mix=0.3)
    finish(buf, f"gacha-burst-{tier}", peak_db=-1.5 - (3 - tier) * 1.2)

# ★3登場のファンファーレ: ドン・ドン → 和音を2回刻んで、伸ばしの和音で開く。
buf = np.zeros((2, secs(4.8)))
place(buf, taiko(1.0, 0.85), 0.0)
place(buf, taiko(1.6, 1.0, 0.9), 0.2)
place(buf, sub_boom(1.6, 0.6, 100, 36), 0.2)
stab = [note(n) for n in ("D4", "A4", "D5", "F#5")]
for at in (0.0, 0.2):
    place(buf, additive(stab, 0.16, 0.012, 0.08, 1200, 4500, level=0.4, voices=3), at)
place(buf, additive([note(n) for n in ("G3", "B4", "D5", "G5")], 0.18, 0.012, 0.1, 1200, 4500, level=0.4, voices=3), 0.4)
big = additive([note(n) for n in ("D3", "A3", "D4", "F#4", "A4", "D5", "F#5")], 2.6, 0.05, 1.6, 800, 6500, level=0.55, voices=3, detune=0.005, vibrato=0.003)
place(buf, big, 0.6)
choir = additive([note(n) for n in ("A4", "D5", "F#5")], 2.4, 0.4, 1.4, 900, 3000, level=0.28, voices=3, formants=[(700, 180, 1.0), (1220, 220, 0.6), (2600, 300, 0.35)], vibrato=0.006)
place(buf, choir, 0.6)
place(buf, crash(2.8, 0.42), 0.6)
place(buf, taiko(1.8, 0.9, 0.8), 0.6)
koto_gliss(buf, 0.62, yo_scale(4, 12, 0), gap=0.035, level=0.4)
for i, nm in enumerate(("D6", "F#6", "A6", "D7")):
    place(buf, stereo(bell(note(nm), 2.6, 0.14), -0.6 + 0.4 * i), 0.62 + 0.05 * i)
sparkles(buf, 0.6, 3.0, 40, level=0.08, density_curve=0.6, low=3000, high=9000)
buf = reverb(buf, rt=2.6, mix=0.3)
finish(buf, "gacha-rare", peak_db=-1.5)

# ---------------------------------------------------------------- メニューのボタン

# ふつうのボタン: 木を軽く打つ「コッ」。
n = secs(0.12)
t = t_of(n)
wood = np.sin(2 * np.pi * 1050 * t) * np.exp(-t / 0.018) + 0.5 * np.sin(2 * np.pi * 2380 * t) * np.exp(-t / 0.009)
tick = bp(rng.uniform(-1, 1, n), 2500, 6000) * np.exp(-t / 0.003)
tap = np.zeros((2, n))
place(tap, stereo(wood * 0.8 + tick * 0.5), 0)
tap = reverb(tap, rt=0.35, mix=0.12, damp=5000)
finish(tap, "ui-tap", peak_db=-9.0, tail_fade=0.03)

# 決定ボタン: 琴の2音（A4→D5）に小さな鈴。
buf = np.zeros((2, secs(1.2)))
place(buf, stereo(koto(note("A4"), 1.0, 0.65, 0.7), -0.15), 0)
place(buf, stereo(koto(note("D5"), 1.0, 0.7, 0.8), 0.15), 0.06)
place(buf, stereo(bell(note("D7"), 0.8, 0.12)), 0.06)
place(buf, stereo(wood[: secs(0.05)] * 0.25), 0)
buf = reverb(buf, rt=0.9, mix=0.2)
finish(buf, "ui-confirm", peak_db=-6.0)


# ---------------------------------------------------------------- 音量をそろえて mp3 へ

# 聞こえる大きさ（LUFS）の目標。リーチ・和了の音（-18）を基準に、溜めは控えめ、はじける音と
# ★3は少し大きく。メニューのボタンは小さく。npm run normalize-audio はこの音を触らない。
LOUDNESS = {
    "gacha-charge-1": -19, "gacha-charge-2": -18.5, "gacha-charge-3": -18,
    "gacha-upgrade-2": -18.5, "gacha-upgrade-3": -17.5,
    "gacha-burst-1": -18.5, "gacha-burst-2": -16.5, "gacha-burst-3": -15.5,
    "gacha-rare": -15, "ui-confirm": -21, "ui-tap": -27,
}


def measure_lufs(path):
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True, errors="replace")
    lines = [l for l in r.stderr.splitlines() if l.strip().startswith("I:")]
    return float(lines[-1].split()[1])


for name, target in LOUDNESS.items():
    wav = os.path.join(OUT, name + ".wav")
    gain = target - measure_lufs(wav)
    dest = os.path.join(DEST, name + ".mp3")
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-af", f"volume={gain:.2f}dB", "-codec:a", "libmp3lame", "-b:a", "160k", dest], check=True)
    print(f"{name}.mp3: {gain:+.1f} dB → {measure_lufs(dest):.1f} LUFS")

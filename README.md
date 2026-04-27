# 1€ + Jitter-Energy Filter Demo

Fork of the [1€ Filter interactive demo](https://gery.casiez.net/1euro/InteractiveDemo/)
that adds the **Jitter-Energy Adaptive Filter** alongside the original filters
(moving average, single exponential, double exponential, Kalman, 1€).

Defaults are curated for the JE-vs-1€ comparison: only those two filters
are enabled, scripted slow circular motion is on, SNR is set so the noise
is visible, and the scripted motion's per-frame delta is matched to the
noise's per-frame delta. JE is auto-calibrated on load and every time SNR
changes.

You can re-enable other filters via their checkboxes (or shortcut keys),
turn off scripted motion to drive with the mouse, and tune any slider.

## What's new

- A new `Jitter-Energy` filter in `filters.js`. It accumulates "jitter energy"
  whenever consecutive raw deltas are small in magnitude *and* reverse
  direction. High energy tightens the low-pass cutoff; low energy raises it.
  Clean monotone movement accumulates no energy, so the filter stays
  responsive on intentional motion while suppressing jitter.
- A **Calibrate JE** button in the bottom-left controls. The Jitter-Energy
  filter has two parameters that depend on the input device's noise scale
  (`magnitudeThreshold`, `energyCeiling`); calibration sets them automatically.
- **Scripted circular motion** in the Input panel. When the mouse is freehand
  it's hard to control the per-frame motion delta precisely, so the win
  condition for JE (motion speed ≈ jitter speed) is hard to reproduce.
  Toggle scripted motion and tune amplitude/frequency until the motion
  per-frame delta is comparable to σ_d — there 1€ either lags or lets jitter
  through, while a calibrated JE tracks the motion smoothly.

## How calibration works

1. Hold the mouse still on the playground.
2. Click **Calibrate JE (2s)**. The demo samples 2 seconds of input deltas.
3. From the measured per-frame delta std σ_d:
   - `magnitudeThreshold ≈ 3 · σ_d` — accepts ~99% of jitter, excludes
     deliberate movement.
   - `energyCeiling` — set empirically by running the JE accumulator on the
     calibration samples (with the user's current `gain` and `decay`) and
     taking ~40% of the observed steady-state energy. This guarantees jitter
     reliably saturates the energy accumulator at runtime so the cutoff
     drops to `fcMin`.

The other JE parameters (`energyGain`, `decayFactor`, `fcMin`, `fcMax`) are
device-independent and use sensible defaults.

## Run locally

```
python3 -m http.server 8080
```

Open <http://localhost:8080/>.

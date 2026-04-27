/*
 * Jitter-Energy filter calibration.
 *
 * The JE filter has two parameters that depend on the noise scale of the input
 * device: magnitudeThreshold and energyCeiling. With well-chosen values the
 * filter saturates fully on jitter (blend → 1, fc → fcMin) while leaving
 * deliberate movement untouched. With mis-tuned values it either never
 * activates (ceiling too high) or activates on every motion (threshold too low).
 *
 * Calibration: ask the user to hold still, sample input deltas for ~2 s, then
 *   1. Compute σ_d (per-frame raw delta std) → set magnitudeThreshold ≈ 3·σ_d
 *      so the gate accepts ~99% of jitter while excluding deliberate movement.
 *   2. Empirically measure what steady-state energy the JE accumulator reaches
 *      on these samples using the user's current gain/decay. Set the ceiling
 *      at a fraction of that observed steady state so jitter reliably pins
 *      blend → 1 (fc → fcMin) at runtime.
 *
 * We measure rather than derive because the closed-form steady-state
 * E_ss ≈ σ_d²·gain / (π·(1−decay)) only holds for two independent gaussian
 * deltas — real input streams have correlation, threshold rejection, and
 * non-gaussian tails that an empirical run captures for free.
 */
(function() {
	var SAMPLE_SECONDS = 2.0;

	function jeFilters() {
		if(!window.filterDemo) return [];
		var out = [];
		for(var i = 0; i < window.filterDemo.filters.length; ++i) {
			var f = window.filterDemo.filters[i];
			if(f.filterClass && f.filterClass.calibratable) out.push(f);
		}
		return out;
	}

	function setParam(filterConfig, paramName, value) {
		filterConfig.configuration[paramName] = value;
		var paramId = '#filter-' + filterConfig.name + '-param-' + paramName;
		// Update the tanglify number/range inputs so the user sees the new value.
		$(paramId + ' .tanglify_value').val(Number(value).toPrecision(4));
	}

	// Run the JE accumulator on a delta stream with given gain/decay/threshold,
	// return the average energy over the second half of the stream (steady state).
	function steadyStateEnergy(deltas, gain, decay, threshold) {
		var E = 0, dPrev = 0;
		var sumTail = 0, nTail = 0;
		var halfway = Math.floor(deltas.length / 2);
		for(var i = 0; i < deltas.length; ++i) {
			var d = deltas[i];
			E *= decay;
			if(Math.abs(d) < threshold) {
				var dot = d * dPrev;
				if(dot < 0) E += (-dot) * gain;
			}
			dPrev = d;
			if(i >= halfway) { sumTail += E; nTail++; }
		}
		return nTail > 0 ? sumTail / nTail : 0;
	}

	function applyToAllJE(sigmaD, deltasX, deltasY) {
		var filters = jeFilters();
		for(var i = 0; i < filters.length; ++i) {
			var f = filters[i];
			var gain = f.configuration.energyGain;
			var decay = f.configuration.decayFactor;
			var threshold = Math.max(3.0 * sigmaD, 0.5);

			// Measure actual steady-state energy on each axis with these params.
			var eX = steadyStateEnergy(deltasX, gain, decay, threshold);
			var eY = steadyStateEnergy(deltasY, gain, decay, threshold);
			var eSs = 0.5 * (eX + eY);

			// Set ceiling well below steady state so the energy clamp pins blend
			// at 1 even during the natural per-frame variance in reversal counts.
			// Without this margin, the quadratic blend amplifies tiny dips in E
			// into spikes in fc, leaking jitter through during stillness.
			var ceiling = Math.max(eSs * 0.2, 0.01);

			setParam(f, 'magnitudeThreshold', threshold);
			setParam(f, 'energyCeiling', ceiling);
			f.configurationChanged();
		}
	}

	function startCalibration($status) {
		if(!window.filterDemo) {
			$status.text('demo not ready');
			return;
		}
		var demo = window.filterDemo;
		var samplesX = [];
		var samplesY = [];
		var lastX = undefined;
		var lastY = undefined;
		var collected = 0;
		var startMs = Date.now();
		$status.text('hold still...');

		// We tap into the demo's tick: simplest robust approach is to poll
		// the noisyX/noisyY refs at the demo's frequency.
		var period = 1000.0 / Math.max(demo.frequency, 1);
		var interval = setInterval(function() {
			var x = demo.noisyX;
			var y = demo.noisyY;
			if(lastX !== undefined) {
				samplesX.push(x - lastX);
				samplesY.push(y - lastY);
			}
			lastX = x;
			lastY = y;
			collected++;

			if((Date.now() - startMs) >= SAMPLE_SECONDS * 1000) {
				clearInterval(interval);

				if(samplesX.length < 8) {
					$status.text('too few samples — try again');
					return;
				}

				var stdX = std(samplesX);
				var stdY = std(samplesY);
				var sigmaD = Math.sqrt(0.5 * (stdX * stdX + stdY * stdY));

				applyToAllJE(sigmaD, samplesX, samplesY);
				$status.text('σ_d=' + sigmaD.toFixed(2) + 'px → ceiling auto-set');
			}
		}, period);
	}

	function std(arr) {
		var n = arr.length;
		if(n === 0) return 0;
		var sum = 0;
		for(var i = 0; i < n; ++i) sum += arr[i];
		var m = sum / n;
		var s = 0;
		for(var i = 0; i < n; ++i) { var d = arr[i] - m; s += d * d; }
		return Math.sqrt(s / Math.max(n - 1, 1));
	}

	// Analytical calibration. The demo's noise function is gaussian with known
	// std (derived from SNR + playground size), so we can compute σ_d directly
	// without sampling. Used for auto-calibration on startup and on SNR change.
	function analyticalSigmaD(demo) {
		var w = demo.$playground.width();
		var h = demo.$playground.height();
		var maxDim = Math.max(w, h);
		var sigmaNoise = maxDim / Math.pow(10, demo.SNR / 20);
		return sigmaNoise * Math.sqrt(2);
	}

	function gaussSample() {
		var u = Math.random() || 1e-9, v = Math.random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}

	function autoCalibrate($status) {
		if(!window.filterDemo) return;
		var demo = window.filterDemo;
		var sigmaD = analyticalSigmaD(demo);
		// Generate synthetic delta samples to feed the empirical accumulator —
		// keeps the steady-state estimation logic identical to the manual path.
		var n = 240, fakeX = new Array(n), fakeY = new Array(n);
		for(var i = 0; i < n; ++i) { fakeX[i] = sigmaD * gaussSample(); fakeY[i] = sigmaD * gaussSample(); }
		applyToAllJE(sigmaD, fakeX, fakeY);
		if($status) $status.text('auto-calibrated: σ_d=' + sigmaD.toFixed(2) + ' px (from SNR)');
	}

	$(function() {
		setTimeout(function() {
			var $det = $('#det');
			if($det.length === 0) return;

			var $wrap = $('<div class="je-calibrate" />').css({
				'margin-top': '6px',
				'padding-top': '6px',
				'border-top': '1px solid #888',
				'color': 'white',
				'font-size': '10px'
			});
			var $btn = $('<button type="button">Calibrate JE (2s, hold still)</button>').css({
				'font-size': '10px',
				'cursor': 'pointer'
			});
			var $status = $('<span class="je-status" />').css({
				'margin-left': '6px',
				'color': '#ddd'
			}).text('');
			$btn.on('click', function() { startCalibration($status); });
			$wrap.append($btn).append($status);
			$wrap.append($('<div/>').css({'margin-top': '4px', 'color': '#aaa', 'font-size': '9px'}).text('Auto-calibrated from SNR on load. Manual button uses live samples.'));

			// Live state readout — shows current JE energy, blend (saturation %)
			// and effective cutoff so it's obvious whether JE is saturated.
			var $diag = $('<div class="je-diag" />').css({'margin-top': '4px', 'color': '#9d9', 'font-size': '10px', 'font-family': 'monospace'}).text('');
			$wrap.append($diag);
			$det.append($wrap);

			autoCalibrate($status);
			if(window.filterDemo && window.filterDemo.SNR$subscribe) {
				window.filterDemo.SNR$subscribe(function() { autoCalibrate($status); });
			}

			// Refresh the live readout 5×/sec.
			setInterval(function() {
				var fs = jeFilters();
				if(fs.length === 0) { $diag.text(''); return; }
				var f = fs[0];
				if(!f.filterX) return;
				var fx = f.filterX;
				var ceiling = fx.energyCeiling;
				var E = fx.E;
				var blend = E / ceiling;
				if(blend > 1) blend = 1;
				var blendSq = blend * blend;
				var fc = fx.fcMax - (fx.fcMax - fx.fcMin) * blendSq;
				$diag.text(
					'JE: thresh=' + fx.magnitudeThreshold.toFixed(1) +
					' ceil=' + ceiling.toFixed(0) +
					' E=' + E.toFixed(0) +
					' blend²=' + blendSq.toFixed(2) +
					' fc=' + fc.toFixed(2) + 'Hz'
				);
			}, 200);
		}, 100);
	});
})();

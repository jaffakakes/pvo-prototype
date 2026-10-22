# Roadmap 9 — broader pressure test research

The creator requested research into efficient, broad pressure testing of the simpler harness, with realistic user requests and edge cases. Research and evaluator calibration are complete. The frozen live comparison and probes have completed; browser/load execution is resuming after the documented evaluator correction and host interruption. The previous comparison result and beta disposition remain unchanged.

- [x] **9P.01** Research primary evaluation guidance and realistic interactive-video use cases; map existing coverage and propose new scenario families.
- [x] **9P.02** Convert the research templates into precise fixtures, supported-capability labels, scripted user answers and independent reference/negative controls. Freeze sources, graders, trial selection and acceptance rules before model evaluation.
- [ ] **9P.03** Run the predeclared broad diagnostic and paired builder comparison, with separate repeatability, browser and controlled-load measurements. Retain all attempts and cleanup evidence.
- [ ] **9P.04** Report category-level results, first versus eventual success, human intervention, root causes, usability and cost; rank fixes without changing the evaluated candidate mid-run.

The [research and 32 scenario templates](../restyle-capability/pressure-test-research.md) distinguish source guidance from proposed Restyle-specific choices. The eight reserved templates need concrete frozen fixtures before they can count as held-out cases. Three trials and controlled viewer-load stages are starting design choices, not statistical reliability guarantees or product request limits.

The [frozen protocol](../restyle-capability/pressure-test-protocol.md) specifies 43 fresh task trials (24 paired builder trials, 14 probes, one connected boundary build, four durable/browser journeys), actual native commits, sealed post-build checks and separate controlled load/host regressions. Existing host tests are distinguished from unseen model tests. No application source or model switch.

Calibration: five evaluator checks pass including real Docker positive/negative controls and actual native commit; browser task-creation preflight passes. Three fixture preparation defects were corrected before inference (transcript text, font shape, normalized layer order); the first source check found one formatting issue, corrected. All original logs remain private. Full Node 22 source check passes 1,799 tests with zero failures/cancellations and five optional skips; syntax, dependency boundaries and formatting pass. Measured outcomes are being retained; see the [execution addendum](../restyle-capability/pressure-test-execution-addendum.md).

Exact next: finish the documented resumed browser/load measurements, resource audit and results. Keep Roadmap 8's rejected rollout gate intact. Do not fix the application or feed sealed failures back to the model during measurement.

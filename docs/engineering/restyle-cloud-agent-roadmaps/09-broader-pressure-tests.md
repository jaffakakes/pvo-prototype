# Roadmap 9 — broader pressure test research

The creator requested research into efficient, broad pressure testing of the simpler harness, with realistic user requests and edge cases. Research is complete; the executable suite below is proposed and has not run. The previous comparison result and beta disposition remain unchanged.

- [x] **9P.01** Research primary evaluation guidance and realistic interactive-video use cases; map existing coverage and propose new scenario families.
- [ ] **9P.02** Convert the research templates into precise fixtures, supported-capability labels, scripted user answers and independent reference/negative controls. Freeze sources, graders, trial selection and acceptance rules before model evaluation.
- [ ] **9P.03** Run the predeclared broad diagnostic and paired builder comparison, with separate repeatability, browser and controlled-load measurements. Retain all attempts and cleanup evidence.
- [ ] **9P.04** Report category-level results, first versus eventual success, human intervention, root causes, usability and cost; rank fixes without changing the evaluated candidate mid-run.

The [research and 32 scenario templates](../restyle-capability/pressure-test-research.md) distinguish source guidance from proposed Restyle-specific choices. The eight reserved templates need concrete frozen fixtures before they can count as held-out cases. Three trials and controlled viewer-load stages are starting design choices, not statistical reliability guarantees or product request limits.

Current work is documentation only, continuing the existing unreleased experiment in `codex/restyle-simple-harness`. No paid model run, new test infrastructure, app modification, real email or deployment occurred during research. Documentation link/content checks are appropriate; product rebuild and browser tests are not applicable.

Exact next: implement and calibrate 9P.02 using the existing test owners. Validate outcome grading against known-correct and deliberately broken outputs before starting a live run. Keep evaluation-driver bugs distinct from model/product failures. Keep Roadmap 8's rejected rollout gate intact; this is a new prospective experiment, not a replacement score for the old one.

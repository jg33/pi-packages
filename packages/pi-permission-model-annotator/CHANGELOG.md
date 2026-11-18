# Changelog

## 0.1.0 (2026-11-18)

### Features

* add `@gotgenes/pi-permission-model-annotator`, a model-backed `model-summary` prompt annotator for pi-permission-system that explains a pending call and appends the jev auto-mode weights when the ask's authorizer trail carries them
* fall back to a deterministic weights-only line, or no annotation at all, on every failure path (no config, no model, failed auth, timeout, throw, empty reply)
* record one `model_annotator.decision` review entry per handled ask through the annotator audit seam

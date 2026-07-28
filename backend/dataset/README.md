# dataset/

`dataset.csv` is generated here — it is **not** committed (see `.gitignore`), because it
contains research data derived from participant recordings.

## How it is produced

One row is appended each time a recording is uploaded **with a `label`**:

```bash
curl -X POST http://127.0.0.1:8000/api/upload \
     -F "file=@control_01.mp4" -F "label=0" -F "subject_id=C001"
```

For demos and integration testing you can synthesise a dataset instead:

```bash
python scripts/generate_synthetic_dataset.py --samples 200 --seed 42
```

## Columns

**Metadata** (traceability, never fed to the model)

`sample_id`, `created_at`, `filename`, `subject_id`, `duration`, `frame_count`, `fps`,
`detection_ratio`, `blink_count`, `saccade_count`, `fixation_ratio`, `saccade_ratio`,
`velocity_std`, `tracking_error_source`

**Features** (in the exact order the model consumes them)

`eye_velocity`, `eye_acceleration`, `eye_distance`, `movement_smoothness`, `blink_rate`,
`fixation_time`, `total_distance`, `average_velocity`, `max_velocity`, `tracking_error`

**Target**

`label` — `0` = control, `1` = at risk.

## Notes

- Keep `tracking_error_source` consistent across the file. `"target"` (a stimulus path was
  supplied) and `"self"` (instability proxy) are different measurements and must not be mixed
  inside one training set.
- Group by `subject_id` when splitting for a real evaluation; multiple recordings of the same
  participant in both the train and test halves will inflate the metrics.
- Column order and the label column name are configurable via `FEATURE_COLUMNS` and
  `LABEL_COLUMN`.

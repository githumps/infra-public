# Datadog dashboard assets

`homey-airwave.gif` is a deterministic, eight-frame status illustration for
the Homey thermostat dashboard. It communicates the specific Airwave state:
the compressor is stopped while the blower continues moving residual cool air.

Regenerate it with FFmpeg and Google Chrome or Chromium installed:

```sh
bash assets/datadog/render-homey-airwave.sh
```

Set `CHROME_BIN=/path/to/browser` when the browser is not installed in a
standard macOS location or available on `PATH` as `google-chrome`/`chromium`.

The source is deliberately procedural so the visual remains reviewable,
reproducible, and independent of a proprietary design file.

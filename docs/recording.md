# Finder file-sorting screen recording

The README shows a real Finder run from September 18, 2026 through Vercel AI Gateway. Jev sorts **nine fictional text files into Invoices, Receipts, and Reports in 22.693 seconds**. All nine destinations and original SHA-256 content hashes pass an independent filesystem check, with no loose files or extras. The verifier ignores Finder's `.DS_Store` metadata.

The preparation script creates the dummy files and empty destination folders. Finder is opened in list view, sorted by Name, before the timed task. For each visible filename, Jev chooses among all three destinations. Native mouse input performs every move; the sorting loop never uses filesystem rename/move calls. The expected manifest and file contents are unavailable to the decision policy.

The native worker checks both drag endpoints against the selected Finder window and approved folder. It rejects multiple selections, stale frames, changed item identities, moved bounds, and covered targets. A read-only preflight may reject a changed screen and request a fresh observation before any input. An uncertain or failed drag itself is never replayed. The harness waits 1.2 seconds after each drop and requires consecutive observations to agree on row positions; these waits are included in the timer.

## Recording and timer

Screen Studio 3.7.5's bundled recorder captures **only the Finder window** at 1840 × 1708. The sidebar and path bar are hidden. The capture excludes the desktop, other apps, camera, microphone, system audio, and keyboard recording. All filenames and contents are fictional. The exports have no audio stream.

The timer is composited from the recorder's start timestamp and the harness's measured elapsed duration. It starts after model warmup and stops only after the independent verification. It includes perception, all ten Jev decisions, native input, Finder settling time, and the final file checks. It is an annotation added during export, not a clock built into Finder.

The 30-second export contains the first 24 seconds without cuts or speed changes, followed by seconds 35–41 of the original capture. Only an idle gap **after verification** is removed. The final segment is labeled result inspection: the operator expands the three folders to reveal all nine files after the timed task. Unused lower rows and the status bar are cropped; task rows remain visible. MP4 is 30 fps; the looping README GIF is 920 pixels wide at 15 fps.

- [Finder MP4](media/jev-finder-demo.mp4)
- [Finder GIF](media/jev-finder-demo.gif)
- [Decision and independent verification trace](evidence/finder-recording-trace.json)
- [Capture timing, editing details, and source/export hashes](evidence/finder-recording.json)
- [Fictional input manifest and content hashes](evidence/finder-manifest.json)

Development trials exposed stale row positions and dropped drag events; those trials stopped and are not shown. The final version passed two consecutive complete runs, in 22.439 and 22.693 seconds. These are functional demonstrations, not broad reliability evidence.

## Record the Finder demo yourself

1. Complete the README setup and provider/desktop checks.
2. Run `npm run demo:finder -- --prepare`. It prints a unique temporary root and manifest path.
3. Open that root in exactly one Finder window. Use list view sorted by Name, collapse all three folders, and hide the sidebar and path bar. Inspect the window for private content.
4. Run `npm run demo:finder -- --manifest /absolute/path/to/manifest.json`. It loads the model, focuses Finder, prints the window ID and artifact directory, then waits for Enter.
5. Select that specific Finder window in Screen Studio, with camera/audio/keyboard recording off. Begin recording, dismiss the picker, and press Enter in the waiting terminal. Leave mouse and keyboard idle until the process exits.
6. Require exit 0 and `passed: true`. The artifact directory contains `trace.json` and per-step `steps.jsonl`. After verification, expand the folders for a clear result inspection and stop recording. Inspect failed runs before preparing a new dataset; the harness will not rerun a partially sorted folder.

For a raw capture from Screen Studio's bundled recorder, `scripts/render-finder-demo.py` can add the measured timer and export MP4/GIF. It requires Python with Pillow, ffmpeg/ffprobe, and the macOS system fonts. Pass the recorder directory, verified trace, and a post-task inspection start time:

```sh
python3 scripts/render-finder-demo.py /path/to/raw-capture /path/to/trace.json \
  --inspection-start 35 --inspection-duration 6
```

The exporter refuses an unverified trace, audio-containing source, or an inspection edit that cuts into the timed task. Review the crop and every exported frame before publishing. Local recordings remain outside Git; only reviewed exports and sanitized evidence belong in the repository.

## Earlier settings demo

The earlier settings recording shows a real run on September 18, 2026 through Vercel AI Gateway: open Settings, choose Dark, enable notifications, and save. Four native clicks and the final Jev DONE decision completed in **2.141 seconds**, including the independent result check. This is one demonstration, not a new reliability or speed benchmark.

The stopwatch is rendered live inside Jev Loop Lab. It starts after CoreML loading and one warmup observation; subsequent perception, network requests, input, and result verification are included. `VERIFIED` appears only after the harness checks the fresh app process's separate result file for Dark, notifications enabled, and a saved page. Jev cannot read that file.

Screen Studio 3.7.5's bundled recorder captured the specific app window at 1800 × 1284. Desktop, other applications, camera, microphone, system audio, and keyboard recording were excluded. The exports contain only the disposable app's fictional content and have no audio stream. The live timer is part of the original capture.

The MP4 preserves normal speed at 30 fps. Only the idle tail was trimmed, leaving a six-second clip with the verified result held on screen. The looping GIF is 900 × 642 at 20 fps. There are no cuts or speed changes during the task.

- [MP4](media/jev-timed-demo.mp4)
- [GIF](media/jev-timed-demo.gif)
- [Raw decision and verification trace](evidence/recording-trace.json)
- [Capture details and file hashes](evidence/recording.json)
- [Source hashes](evidence/recording-source-hashes.json)

An earlier capture attempt did not pass: Screen Studio's window-selection overlay intercepted the first click, and the loop exhausted its step limit. That take was excluded. Dismissing the overlay allowed the next run, shown here, to complete. No loop or decision-policy changes were made between attempts.

### Record the settings demo

1. Complete the README setup, including a provider token, model conversion, native build, and permissions.
2. Run `JEV_PROVIDER=vercel npm run record:demo` (or choose `openrouter` / `typesafe`). The terminal prints the disposable window's ID and local artifact folder.
3. In Screen Studio, select **Window → Jev Loop Lab**. Turn off camera, microphone, and system audio. Start recording and make sure the window-selection overlay has closed.
4. Press Enter in the waiting terminal. The harness focuses the demo and runs the task; leave the mouse and keyboard alone until it stops.
5. Stop the recorder after `VERIFIED` appears, then press Enter in the terminal to close the disposable app. A failed run displays `STOPPED` and exits with a nonzero status.

The harness records its result and trace under the Git-ignored `artifacts/recording-*` folder. Review your exported footage before publishing it. The stopwatch is enabled only by this harness; normal benchmark runs keep their existing layout.

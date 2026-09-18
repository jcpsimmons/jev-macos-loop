# Finder batch-sorting screen recording

The README shows a real Finder run from September 18, 2026 through Vercel AI Gateway. Jev sorts **nine fictional text files in three group moves in 7.387 seconds**. All nine destinations and original SHA-256 content hashes pass an independent filesystem check, with no loose files or extras. The verifier ignores Finder's `.DS_Store` metadata.

The preparation script creates the dummy files and three empty destination folders. Finder is opened in list view, sorted by Name, before the timed task. Jev classifies all nine visible filenames in one request containing nine finite-choice questions. The runner groups those answers by destination, selects each exact group through macOS accessibility, and performs one native mouse drag per group. A second Jev request confirms completion. File grouping follows Jev's answers, not a hardcoded prefix classifier. The sorting loop never uses filesystem rename/move calls, and cannot read the expected manifest or file contents.

Every group member and destination must be a direct item in the approved Finder directory. After selecting a group, the runner takes a fresh observation and rebinds all element IDs. The native worker rechecks identities, focus, occlusion, bounds, and the complete selected-file set before dragging. An extra selected item rejects the drag. Unexpected visible files, uncertain decisions, and selection/input failures stop the run; selection and drag mutations are never replayed. The existing single-file guard still rejects multiple selections.

The runner retains a 1.2-second settling wait after each drop, now only three times rather than nine. It confirms every group member has disappeared from the source listing before proceeding. Those waits and the independent final file checks are included in the timer.

## Recorded comparison

| Same nine-file task            | Individual moves | Group moves |
| ------------------------------ | ---------------: | ----------: |
| Verified elapsed time          |         22.693 s |     7.387 s |
| Native drags                   |                9 |           3 |
| Jev requests                   |               10 |           2 |
| Fixed settling waits           |           10.8 s |       3.6 s |
| Correct files, original hashes |              9/9 |         9/9 |

The batch version took about one third of the time in these recordings. Its first complete trial passed in 7.508 seconds; the recorded trial passed in 7.387 seconds. These are functional demonstrations, not a broad reliability study or controlled latency benchmark. The earlier single-file recording remains available as [MP4](media/jev-finder-demo.mp4), [trace](evidence/finder-recording-trace.json), and [capture evidence](evidence/finder-recording.json).

## Recording and timer

Screen Studio 3.7.5's bundled recorder captures **only the Finder window** at 1840 × 1708. The sidebar and path bar are hidden. The capture excludes the desktop, other apps, camera, microphone, system audio, and keyboard recording. All filenames and contents are fictional. The exports have no audio stream.

The timer is composited from the recorder's start timestamp and the harness's measured elapsed duration. It starts after model warmup and stops only after the independent verification. It includes perception, both Jev requests, native selection and input, Finder settling time, and the final file checks. It is an annotation added during export, not a clock built into Finder.

The 15-second export contains the first nine seconds without cuts or speed changes, followed by seconds 16–22 of the original capture. Only an idle gap **after verification** is removed. The final segment is labeled result inspection: the operator expands the folders to reveal all nine files after the timed task. Unused lower rows and the status bar are cropped; all task rows remain visible. MP4 is 30 fps; the looping README GIF is 920 pixels wide at 15 fps.

- [Batch Finder MP4](media/jev-finder-batch-demo.mp4)
- [Batch Finder GIF](media/jev-finder-batch-demo.gif)
- [Batch decisions and independent verification trace](evidence/finder-batch-recording-trace.json)
- [Capture timing, editing details, and source/export hashes](evidence/finder-batch-recording.json)
- [Fictional input manifest and content hashes](evidence/finder-manifest.json)

Offline tests cover classification batching, noncontiguous groups, uncertain decisions, changing element IDs, unexpected files, missed moves, and non-retry behavior. Live native checks also rejected stale frames, outside-root targets, duplicate members, folders used as files, and a group whose selection did not match. The two complete batch trials passed all destination and hash checks.

## Record the Finder demo yourself

1. Complete the README setup and provider/desktop checks.
2. Run `npm run demo:finder -- --prepare`. It prints a unique temporary root and manifest path.
3. Open that root in exactly one Finder window. Use list view sorted by Name, collapse all three folders, and hide the sidebar and path bar. Inspect the window for private content.
4. Run `npm run demo:finder -- --manifest /absolute/path/to/manifest.json`. It loads the model, focuses Finder, prints the window ID and artifact directory, then waits for Enter. Batch mode is the default; `--single` reproduces individual moves.
5. Select that specific Finder window in Screen Studio, with camera/audio/keyboard recording off. Begin recording, dismiss the picker, and press Enter in the waiting terminal. Leave mouse and keyboard idle until the process exits.
6. Require exit 0 and `passed: true`. The artifact directory contains `trace.json` and per-step `steps.jsonl`. After verification, expand the folders for a clear result inspection and stop recording. Inspect failed runs before preparing a new dataset; the harness will not rerun a partially sorted folder.

For a raw capture from Screen Studio's bundled recorder, `scripts/render-finder-demo.py` can add the measured timer and export MP4/GIF. It requires Python with Pillow, ffmpeg/ffprobe, and the macOS system fonts. Pass the recorder directory, verified trace, and a post-task inspection start time:

```sh
python3 scripts/render-finder-demo.py /path/to/raw-capture /path/to/trace.json \
  --inspection-start 16 --inspection-duration 6 --output docs/media/jev-finder-batch-demo
```

The exporter refuses an unverified trace, audio-containing source, or an inspection edit that cuts into the timed task. Review the crop and exported frames before publishing. Local recordings remain outside Git; only reviewed exports and sanitized evidence belong in the repository.

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

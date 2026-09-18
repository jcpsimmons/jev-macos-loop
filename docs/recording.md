# Timed screen recording

The README shows a real run on September 18, 2026 through Vercel AI Gateway: open Settings, choose Dark, enable notifications, and save. Four native clicks and the final Jev DONE decision completed in **2.141 seconds**, including the independent result check. This is one demonstration, not a new reliability or speed benchmark.

The stopwatch is rendered live inside Jev Loop Lab. It starts after CoreML loading and one warmup observation; subsequent perception, network requests, input, and result verification are included. `VERIFIED` appears only after the harness checks the fresh app process's separate result file for Dark, notifications enabled, and a saved page. Jev cannot read that file.

Screen Studio 3.7.5's bundled recorder captured the specific app window at 1800 × 1284. Desktop, other applications, camera, microphone, system audio, and keyboard recording were excluded. The exports contain only the disposable app's fictional content and have no audio stream. The live timer is part of the original capture.

The MP4 preserves normal speed at 30 fps. Only the idle tail was trimmed, leaving a six-second clip with the verified result held on screen. The looping GIF is 900 × 642 at 20 fps. There are no cuts or speed changes during the task.

- [MP4](media/jev-timed-demo.mp4)
- [GIF](media/jev-timed-demo.gif)
- [Raw decision and verification trace](evidence/recording-trace.json)
- [Capture details and file hashes](evidence/recording.json)
- [Source hashes](evidence/recording-source-hashes.json)

An earlier capture attempt did not pass: Screen Studio's window-selection overlay intercepted the first click, and the loop exhausted its step limit. That take was excluded. Dismissing the overlay allowed the next run, shown here, to complete. No loop or decision-policy changes were made between attempts.

## Record your own

1. Complete the README setup, including a provider token, model conversion, native build, and permissions.
2. Run `JEV_PROVIDER=vercel npm run record:demo` (or choose `openrouter` / `typesafe`). The terminal prints the disposable window's ID and local artifact folder.
3. In Screen Studio, select **Window → Jev Loop Lab**. Turn off camera, microphone, and system audio. Start recording and make sure the window-selection overlay has closed.
4. Press Enter in the waiting terminal. The harness focuses the demo and runs the task; leave the mouse and keyboard alone until it stops.
5. Stop the recorder after `VERIFIED` appears, then press Enter in the terminal to close the disposable app. A failed run displays `STOPPED` and exits with a nonzero status.

The harness records its result and trace under the Git-ignored `artifacts/recording-*` folder. Review your exported footage before publishing it. The stopwatch is enabled only by this harness; normal benchmark runs keep their existing layout.

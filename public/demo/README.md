# Video-effect demos

Updated on 2026-10-29 from the user-supplied `270507.mp4`. These files replace the previous Gojo/anime-scene demos. This is the separate video-effects comparison; the Ichika illustration and pending Flipbook animation are unchanged.

- Source SHA-256: `2c556faa1aa3ef1edbd3c4a07cad18379ea24d5f7cdb4a5f777264c04cc9f587`.
- Excerpt: first 8 seconds, normalized once to 960×540, 24 fps, 192 frames, H.264/yuv420p. The source has no audio.
- Segmentation: actual SAM 3.1 video passes for `cat`, `bird` and `wooden fence`, merged with independent object IDs for Reality Shift and Motion Echo. Their selection includes one cat, six birds and one fence. Break the Frame uses only the original cat tracking pass. Cat and fence have masks on 192/192 frames; bird masks follow each bird from its appearance in the clip. No selected-mask frame is missing.
- Effects: actual `renderVideo` and `trackingMaskSource` from `server/video/compositor.ts`, with natural finishing and no extra generated content.

| File | Focus effect | Parameters |
| --- | --- | --- |
| `reality-shift.mp4` | Background blur | Cat, birds and fence remain sharp; high background blur, feather 1.5 |
| `break-the-frame.mp4` | Break the Frame | Only the cat breaks out; compact frame, dark background, feather 1.2; cat crosses the edge in all 192 frames |
| `motion-echo.mp4` | Motion Echo | Six trails, 400 ms spacing, intensity 0.85, feather 1.2; visible in the flying birds and moving tail |

Each demo keeps the existing player format: original above, edited below in one synchronized 960×1080 stream. Each matching JPG is taken at 6 seconds, with the birds in view, from that same stream. All MP4s were verified with FFprobe for codec, dimensions, frame rate, duration, frame count and absence of audio. The original 4K upload and tracking files are kept locally outside the public assets.

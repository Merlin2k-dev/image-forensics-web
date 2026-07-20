# image-forensics web UI

Static front end for my white-box AI-image detector. Upload an image and the page
returns a graded verdict (likely AI-generated, leaning AI-generated, inconclusive,
or likely real) with the evidence behind it shown panel by panel, plus a downloadable
PDF report.

The detector itself lives in
[ai-image-forensics](https://github.com/Merlin2k-dev/ai-image-forensics):
27 hand-crafted signal-processing measurements feeding a logistic regression,
no neural networks, evaluated only on generators and photo sources the model
never trained on.

## Live analysis

Scoring runs server-side. Point `API_BASE` (top of `app.js`) at a running scoring
service to enable uploads and drag-and-drop from other sites. Without it the page
runs in demo mode: uploads still show the exact preprocessing the model reads
(512 px center crop, luminance), and two real sample reports are bundled.

## Hosting

Plain HTML/CSS/JS, no build step. GitHub Pages serves it from the repo root
(`.nojekyll` included).

## License

MIT.

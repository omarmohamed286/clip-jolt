import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import dotenv from "dotenv";
import { getHighlighter } from "shiki";
dotenv.config();
import { DEFAULTS, CODING_CHALLENGE_PROMPT } from "./constants.js";


function getTimestampedFolder() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `output_${year}${month}${day}_${hours}${minutes}${seconds}`;
}

async function generateSnippetWithAI(index) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  console.log(`Generating snippet ${index + 1}...`);

  const response = await generateText({
    model: openai("gpt-4o"),
    prompt: CODING_CHALLENGE_PROMPT,
    maxTokens: 500,
    temperature: 0.9
  });

  let cleanText = response.text.trim();
  cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  const snippet = JSON.parse(cleanText);
  return snippet;
}

async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

async function getRandomAudioFile(audioFolder) {
  console.log("\nSelecting random audio file...");

  try {
    const files = await fs.readdir(audioFolder);

    const audioFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext);
    });

    if (audioFiles.length === 0) {
      throw new Error(`No audio files found in ${audioFolder}`);
    }

    const randomIndex = Math.floor(Math.random() * audioFiles.length);
    const selectedAudio = audioFiles[randomIndex];
    const audioPath = path.join(audioFolder, selectedAudio);

    console.log(`✓ Selected audio: ${selectedAudio}`);

    return audioPath;
  } catch (err) {
    throw new Error(`Failed to read audio folder: ${err.message}`);
  }
}

async function extractRandomVideoSegment(inputVideo, outputVideo, duration) {
  console.log("\nExtracting random segment from b-roll video...");

  const totalDuration = await getVideoDuration(inputVideo);
  const maxStartTime = Math.max(0, totalDuration - duration);
  const startTime = Math.random() * maxStartTime;

  console.log(`B-roll duration: ${totalDuration.toFixed(2)}s`);
  console.log(`Extracting ${duration}s from ${startTime.toFixed(2)}s`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputVideo)
      .setStartTime(startTime)
      .setDuration(duration)
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-preset medium',
        '-crf 23'
      ])
      .output(outputVideo)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\rProgress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`\n✓ Video segment extracted: ${outputVideo}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('\nFFmpeg error:', err.message);
        reject(new Error('Failed to extract video segment.'));
      })
      .run();
  });
}

// Modified to remove difficulty level from the image
async function renderSnippet(code, difficulty, outputPath, browser) {
  const highlighter = await getHighlighter({
    themes: ["nord"],
    langs: ["javascript"]
  });

  const codeHtml = highlighter.codeToHtml(code, {
    lang: "javascript",
    theme: "nord"
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    deviceScaleFactor: DEFAULTS.scale
  });

  const html = buildHtml({
    codeHtml,
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    padding: DEFAULTS.padding,
    background: DEFAULTS.background,
    font: DEFAULTS.font,
    fontSize: DEFAULTS.fontSize
  });

  await page.setContent(html, { waitUntil: "load" });

  await page.screenshot({
    path: outputPath,
    fullPage: false,
    omitBackground: true
  });
  await page.close();

  console.log(`  ✓ Rendered: ${outputPath}`);
}

// Modified to remove difficulty level
function buildHtml({ codeHtml, width, height, padding, background, font, fontSize }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>snippet</title>
  <style>
    :root {
      --frame-radius: 16px;
      --frame-bg: #0b1120;
      --chrome-bg: linear-gradient(90deg, #0f172a 0%, #111827 100%);
      --chrome-border: rgba(148, 163, 184, 0.16);
      --shadow: 0 30px 60px rgba(2, 6, 23, 0.6);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 60px;
      background: transparent;
      font-family: ${font};
      padding: ${padding}px;
    }
    .header {
      text-align: center;
      color: #e2e8f0;
      padding: 30px 60px;
    }
    .header h1 {
      font-size: 72px;
      font-weight: 700;
      margin: 0;
      letter-spacing: -0.02em;
      text-shadow: 
        -2px -2px 0 #000,
        2px -2px 0 #000,
        -2px 2px 0 #000,
        2px 2px 0 #000,
        0 0 20px rgba(0, 0, 0, 0.5);
    }
    .frame {
      margin-top: 50px;
      width: ${width - padding * 2}px;
      background: var(--frame-bg);
      border-radius: var(--frame-radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.18);
      backdrop-filter: blur(10px);
    }
    .chrome {
      height: 50px;
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 16px;
      background: var(--chrome-bg);
      border-bottom: 1px solid var(--chrome-border);
      color: #cbd5f5;
      font-size: 14px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .dots { display: flex; gap: 10px; }
    .dot { width: 14px; height: 14px; border-radius: 999px; }
    .dot.red { background: #f87171; }
    .dot.yellow { background: #facc15; }
    .dot.green { background: #4ade80; }
    .code {
      padding: 40px;
      font-size: ${fontSize}px;
      line-height: 1.6;
      color: #e2e8f0;
    }
    .code pre,
    .code code {
      margin: 0;
      white-space: pre;
      font-family: inherit;
    }
    .code pre.shiki {
      background: transparent !important;
      padding: 0 !important;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>What Is The Output?</h1>
  </div>
  <div class="frame">
    <div class="chrome">
      <div class="dots">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
      </div>
    </div>
    <div class="code">
      ${codeHtml}
    </div>
  </div>
</body>
</html>`;
}

// New function to add level text with FFmpeg
async function overlayCodeOnVideoWithAudio(backgroundVideo, overlayImage, audioPath, outputVideo, duration, difficulty) {
  console.log("\nOverlaying code snippet on background video and adding audio...");

  const levelY = 840; // Position between "What Is The Output?" and the code frame

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(backgroundVideo)
      .input(overlayImage)
      .input(audioPath)
      .complexFilter([
        // Scale and position the overlay image
        '[1:v]scale=1080:1920[overlay]',
        '[0:v][overlay]overlay=0:0[video_base]',
        // Add level text that appears at 2 seconds
        `[video_base]drawtext=` +
        `text='LEVEL\\: ${difficulty}':` +
        `fontfile=/System/Library/Fonts/Supplemental/Arial\\ Bold.ttf:` +
        `fontsize=42:` +
        `fontcolor=#818cf8:` +
        `borderw=2:` +
        `bordercolor=black:` +
        `x=(w-text_w)/2:` +
        `y=${levelY}:` +
        `enable='gte(t,${DEFAULTS.levelAppearTime})':` +
        `alpha='if(lt(t,${DEFAULTS.levelAppearTime}),0,if(lt(t,${DEFAULTS.levelAppearTime + 0.3}),(t-${DEFAULTS.levelAppearTime})/0.3,1))'` +
        `[video]`,
        // Trim audio to match video duration
        `[2:a]atrim=0:${duration},asetpts=PTS-STARTPTS[audio]`
      ])
      .outputOptions([
        '-map [video]',
        '-map [audio]',
        '-c:v libx264',
        '-c:a aac',
        '-b:a 192k',
        `-t ${duration}`,
        '-pix_fmt yuv420p',
        '-preset medium',
        '-crf 23',
        '-shortest'
      ])
      .output(outputVideo)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\rProgress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`\n✓ Final video with audio and level text created: ${outputVideo}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('\nFFmpeg error:', err.message);
        reject(new Error('Failed to overlay code on video with audio.'));
      })
      .run();
  });
}

export async function generateCodingChallengeReel() {
  const outputDir = `./${getTimestampedFolder()}`;
  const imagePath = path.join(outputDir, "snippet.png");
  const bRollSegmentPath = path.join(outputDir, "broll_segment.mp4");
  const videoPath = path.join(outputDir, "reel.mp4");
  const captionPath = path.join(outputDir, "caption.txt");

  await fs.mkdir(outputDir, { recursive: true });
  console.log(`\n📁 Output directory: ${outputDir}\n`);

  const duration = DEFAULTS.videoDuration;

  try {
    await fs.access(DEFAULTS.bRollPath);
  } catch (err) {
    throw new Error(`B-roll video not found at: ${DEFAULTS.bRollPath}`);
  }

  try {
    await fs.access(DEFAULTS.audioFolder);
  } catch (err) {
    throw new Error(`Audio folder not found at: ${DEFAULTS.audioFolder}`);
  }

  console.log(`Generating 1 code snippet for a ${duration}s video...\n`);

  const browser = await puppeteer.launch({ headless: "new" });

  try {
    const snippet = await generateSnippetWithAI(0);

    await renderSnippet(snippet.code, snippet.difficulty, imagePath, browser);

    await extractRandomVideoSegment(DEFAULTS.bRollPath, bRollSegmentPath, duration);

    const audioPath = await getRandomAudioFile(DEFAULTS.audioFolder);

    // Pass difficulty to the overlay function
    await overlayCodeOnVideoWithAudio(bRollSegmentPath, imagePath, audioPath, videoPath, duration, snippet.difficulty);

    const captionContent =
      `==================== REEL ====================\n` +
      `DIFFICULTY: ${snippet.difficulty}\n\n` +
      `CODE:\n${snippet.code}\n\n` +
      `CAPTION:\n${snippet.caption}\n\n` +
      `AUDIO: ${path.basename(audioPath)}\n`;

    await fs.writeFile(captionPath, captionContent);
    console.log(`✓ Caption saved: ${captionPath}`);

    console.log("\n" + "=".repeat(60));
    console.log("✨ ALL DONE!");
    console.log("=".repeat(60));
    console.log(`📁 Folder: ${outputDir}`);
    console.log(`🎥 Video: ${videoPath}`);
    console.log(`📝 Caption: ${captionPath}`);
    console.log(`🖼️  Image: ${imagePath}`);
    console.log(`🎬 B-roll segment: ${bRollSegmentPath}`);
    console.log(`🎵 Audio: ${path.basename(audioPath)}`);
    console.log(`⏱️  Level appears at: ${DEFAULTS.levelAppearTime}s`);

    return {
      outputDir,
      videoPath,
      captionPath,
      imagePath,
      bRollSegmentPath,
      audioPath,
      snippet
    };
  } finally {
    await browser.close();
  }
}

// Allow running directly as a script
const __filename = fileURLToPath(import.meta.url);
const mainPath = process.argv[1] ? path.normalize(process.argv[1]) : '';
if (mainPath && path.normalize(__filename) === mainPath) {
  generateCodingChallengeReel().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
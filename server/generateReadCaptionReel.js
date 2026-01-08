import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'fluent-ffmpeg';
import dotenv from 'dotenv';
dotenv.config();
import { MAIN_TEXT_PROMPT } from './constants.js';
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import os from 'os';


const generateTextWithLLM = async (mainText, subText) => {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("Missing OPENAI_API_KEY. Set it to run the OpenAI warmup call.");
    }
    
    // Enhance prompt to request variation
    const variationPrompt = MAIN_TEXT_PROMPT + `

IMPORTANT: You must generate a UNIQUE and DIFFERENT hook each time. Do NOT repeat the same hook. Vary the number, wording, and angle. Choose from the approved templates or create a new variation that matches the tone and style. Each generation should feel fresh and different from previous ones.`;
    
    const response = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: z.object({
            hook: z.string().describe("Curiosity hook ending with (Read caption), no emojis"),
            caption: z.string().describe("Full long-form caption with emojis and numbered bullets"),
            cta: z.string().describe("Comment keyword CTA line")
        }),
        prompt: variationPrompt,
        temperature: 0.9, // Higher temperature for more variation
    });
    return response.object
};

/**
 * Get random audio file from audio directory
 */
function getRandomAudioFile() {
    const audioDir = 'audio';

    if (!fs.existsSync(audioDir)) {
        console.log('Warning: audio directory not found, proceeding without background music');
        return null;
    }

    const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
    const audioFiles = fs.readdirSync(audioDir)
        .filter(file => audioExtensions.includes(path.extname(file).toLowerCase()))
        .map(file => path.join(audioDir, file));

    if (audioFiles.length === 0) {
        console.log('Warning: no audio files found in audio directory');
        return null;
    }

    const randomAudio = audioFiles[Math.floor(Math.random() * audioFiles.length)];
    console.log(`Selected random audio: ${randomAudio}`);

    return randomAudio;
}

/**
 * Create output folder with timestamp
 */
function createOutputFolder() {
    const timestamp = new Date().toISOString()
        .replace(/:/g, '-')
        .replace(/\..+/, '')
        .replace('T', '_');
    const folderName = `output_${timestamp}`;

    if (!fs.existsSync(folderName)) {
        fs.mkdirSync(folderName, { recursive: true });
    }

    return folderName;
}

/**
 * Get video duration using ffprobe
 */
function getVideoDuration(inputFile) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputFile, (err, metadata) => {
            if (err) {
                reject(new Error(`Failed to get video duration: ${err.message}`));
                return;
            }

            const duration = metadata.format.duration;
            if (!duration) {
                reject(new Error('Duration not found in video metadata'));
                return;
            }

            resolve(duration);
        });
    });
}

/**
 * Extract video segment using ffmpeg
 */
function extractSegment(inputFile, startTime, duration, outputFile) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputFile)
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions([
                '-c:v libx264',
                '-c:a aac'
            ])
            .output(outputFile)
            .on('end', () => resolve(outputFile))
            .on('error', (err) => reject(new Error(`Failed to extract segment: ${err.message}`)))
            .run();
    });
}

/**
 * Loop video to fill duration using ffmpeg concat
 */
async function loopVideo(inputFile, targetDuration, outputFile, tempDir) {
    const duration = await getVideoDuration(inputFile);
    const loopsNeeded = Math.ceil(targetDuration / duration);

    // Create concat file
    const concatFile = path.join(tempDir, 'concat.txt');
    const concatContent = Array(loopsNeeded)
        .fill(`file '${inputFile.replace(/'/g, "'\\''")}'`)
        .join('\n');

    fs.writeFileSync(concatFile, concatContent);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(concatFile)
            .inputOptions(['-f concat', '-safe 0'])
            .setDuration(targetDuration)
            .outputOptions([
                '-c:v libx264',
                '-c:a aac'
            ])
            .output(outputFile)
            .on('end', () => resolve(outputFile))
            .on('error', (err) => reject(new Error(`Failed to loop video: ${err.message}`)))
            .run();
    });
}

/**
 * Wrap text to fit within a maximum width
 */
function wrapText(text, maxCharsPerLine = 30) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        if (testLine.length <= maxCharsPerLine) {
            currentLine = testLine;
        } else {
            if (currentLine) {
                lines.push(currentLine);
            }
            currentLine = word;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.join('\n');
}


/**
 * Main video processing function
 */
export async function generateReadCaptionReel() {
    const inputFile = 'bRoll.mov';

    if (!fs.existsSync(inputFile)) {
        throw new Error(`Video file not found: ${inputFile}`);
    }

    // Get random audio file
    const audioFile = getRandomAudioFile();

    console.log(`Getting video duration from ${inputFile}...`);
    const duration = await getVideoDuration(inputFile);
    console.log(`Video duration: ${duration.toFixed(2)} seconds`);

    // Calculate random start time
    let startTime = 0;
    if (duration < 7) {
        console.log('Video is shorter than 7 seconds, will loop to fill 7 seconds');
    } else {
        startTime = Math.random() * (duration - 7);
    }

    console.log(`Extracting segment starting at ${startTime.toFixed(2)} seconds...`);

    // Create temp directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-reel-'));
    const tempSegment = path.join(tempDir, 'segment.mp4');
    const tempResized = path.join(tempDir, 'resized.mp4');

    try {
        // Extract or loop segment
        if (duration < 7) {
            const tempFull = path.join(tempDir, 'full.mp4');
            await extractSegment(inputFile, 0, duration, tempFull);
            await loopVideo(tempFull, 7, tempSegment, tempDir);
        } else {
            await extractSegment(inputFile, startTime, 7, tempSegment);
        }

        console.log('Resizing to 9:16 aspect ratio (1080x1920)...');

        // Target dimensions
        const targetWidth = 1080;
        const targetHeight = 1920;

        // Resize and crop to 9:16 aspect ratio
        await new Promise((resolve, reject) => {
            ffmpeg(tempSegment)
                .outputOptions([
                    '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
                    '-c:v', 'libx264',
                    '-c:a', 'aac'
                ])
                .output(tempResized)
                .on('end', resolve)
                .on('error', (err) => reject(new Error(`Failed to resize: ${err.message}`)))
                .run();
        });

        // Create output folder
        const outputFolder = createOutputFolder();
        const outputPath = path.join(outputFolder, 'reel.mp4');

        console.log('Generating text and captions...');

        const { hook, caption, cta } = await generateTextWithLLM();
        console.log('----------------Hook----------------:\n', hook);
        console.log('----------------Caption----------------:\n', caption);
        console.log('----------------CTA----------------:\n', cta);


        // Text to display
        const mainText = hook;
        const subText = '(Read caption)';


        // Wrap text and split into lines
        const mainLines = wrapText(mainText, 30).split('\n');  // Increased to ~30 chars per line
        const subLines = wrapText(subText, 25).split('\n');

        console.log('Main text will be displayed as:');
        mainLines.forEach((line, i) => console.log(`  Line ${i + 1}: ${line}`));

        // Escape text for ffmpeg
        const escapeForDrawtext = (text) => {
            return text
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\\\'")
                .replace(/:/g, '\\:');
        };

        // Calculate starting Y position for main caption (centered vertically)
        const mainFontSize = 60;
        const mainLineSpacing = 20;
        const mainTotalHeight = (mainLines.length * mainFontSize) + ((mainLines.length - 1) * mainLineSpacing);
        const mainStartY = (targetHeight / 2) - (mainTotalHeight / 2) - 100; // Offset up a bit

        // Calculate starting Y position for subcaption
        const subFontSize = 40;
        const subLineSpacing = 15;
        const subTotalHeight = (subLines.length * subFontSize) + ((subLines.length - 1) * subLineSpacing);
        const subStartY = mainStartY + mainTotalHeight + 80; // Below main with spacing

        // Create drawtext filters for each line
        const drawtextFilters = [];

        // Main caption lines
        mainLines.forEach((line, index) => {
            const yPos = mainStartY + (index * (mainFontSize + mainLineSpacing));
            const escapedLine = escapeForDrawtext(line);
            drawtextFilters.push(
                `drawtext=fontfile=Inter.ttf:` +
                `text='${escapedLine}':` +
                `fontcolor=white:` +
                `fontsize=${mainFontSize}:` +
                `x=(w-text_w)/2:` +
                `y=${yPos}:` +
                `borderw=3:` +
                `bordercolor=black`
            );
        });

        // Subcaption lines (appear at 4 seconds)
        subLines.forEach((line, index) => {
            const yPos = subStartY + (index * (subFontSize + subLineSpacing));
            const escapedLine = escapeForDrawtext(line);
            drawtextFilters.push(
                `drawtext=fontfile=Inter.ttf:` +
                `text='${escapedLine}':` +
                `fontcolor=white:` +
                `fontsize=${subFontSize}:` +
                `x=(w-text_w)/2:` +
                `y=${yPos}:` +
                `enable='gte(t,4)':` +
                `borderw=2:` +
                `bordercolor=black`
            );
        });

        console.log(`Exporting to ${outputPath}...`);

        // Build ffmpeg command with audio
        const ffmpegCommand = ffmpeg(tempResized);

        // Add audio input if available
        if (audioFile) {
            console.log('Adding background audio...');
            ffmpegCommand.input(audioFile);
        }

        const outputOptions = [
            '-vf', drawtextFilters.join(','),
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-b:v', '8000k',
            '-r', '24'
        ];

        // Configure audio mixing
        if (audioFile) {
            outputOptions.push(
                '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=2[aout]',
                '-map', '0:v',
                '-map', '[aout]',
                '-c:a', 'aac',
                '-b:a', '192k'
            );
        } else {
            outputOptions.push('-c:a', 'aac');
        }

        await new Promise((resolve, reject) => {
            ffmpegCommand
                .outputOptions(outputOptions)
                .output(outputPath)
                .on('end', () => {
                    console.log(`\n✓ Video exported successfully to: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => reject(new Error(`Failed to add captions: ${err.message}`)))
                .run();
        });

        // Read caption file content if needed
        const captionContent = `${hook}\n\n${caption}\n\n${cta}`;
        const captionPath = path.join(outputFolder, 'caption.txt');
        fs.writeFileSync(captionPath, captionContent);
        console.log(`✓ Caption saved: ${captionPath}`);

        return {
            outputFolder,
            videoPath: outputPath,
            captionPath,
            hook,
            caption,
            cta
        };
    } finally {
        // Clean up temp files
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// Allow running directly as a script
const __filename = fileURLToPath(import.meta.url);
const mainPath = process.argv[1] ? path.normalize(process.argv[1]) : '';
if (mainPath && path.normalize(__filename) === mainPath) {
    generateReadCaptionReel()
        .catch(err => {
            console.error('Error:', err.message);
            process.exit(1);
        });
}
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCodingChallengeReel } from './generateCodingChallengeReel.js';
import { generateReadCaptionReel } from './generateReadCaptionReel.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to normalize paths relative to server directory
const normalizePath = (p) => path.normalize(p).replace(/^\.\//, '');

// Helper function to create HTTP URL for a file path
const createFileUrl = (filePath, req) => {
  const normalizedPath = normalizePath(filePath);
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}/${normalizedPath}`;
};

// Serve static files from the server directory
app.use(express.static(__dirname));

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Generate coding challenge reel endpoint
app.post('/api/generate/coding-challenge', async (req, res) => {
  try {
    console.log('📹 Generating coding challenge reel...');
    
    const result = await generateCodingChallengeReel();
    
    res.json({
      success: true,
      message: 'Coding challenge reel generated successfully',
      data: {
        outputDir: normalizePath(result.outputDir),
        videoPath: normalizePath(result.videoPath),
        videoUrl: createFileUrl(result.videoPath, req),
        captionPath: normalizePath(result.captionPath),
        captionUrl: createFileUrl(result.captionPath, req),
        imagePath: normalizePath(result.imagePath),
        imageUrl: createFileUrl(result.imagePath, req),
        snippet: {
          difficulty: result.snippet.difficulty,
          code: result.snippet.code,
          caption: result.snippet.caption
        }
      }
    });
  } catch (error) {
    console.error('Error generating coding challenge reel:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate coding challenge reel'
    });
  }
});

// Generate read caption reel endpoint
app.post('/api/generate/read-caption', async (req, res) => {
  try {
    console.log('📹 Generating read caption reel...');
    
    const result = await generateReadCaptionReel();
    
    res.json({
      success: true,
      message: 'Read caption reel generated successfully',
      data: {
        outputFolder: normalizePath(result.outputFolder),
        videoPath: normalizePath(result.videoPath),
        videoUrl: createFileUrl(result.videoPath, req),
        captionPath: normalizePath(result.captionPath),
        captionUrl: createFileUrl(result.captionPath, req),
        hook: result.hook,
        caption: result.caption,
        cta: result.cta
      }
    });
  } catch (error) {
    console.error('Error generating read caption reel:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate read caption reel'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📹 Coding Challenge: POST http://localhost:${PORT}/api/generate/coding-challenge`);
  console.log(`📹 Read Caption: POST http://localhost:${PORT}/api/generate/read-caption`);
});


// config/config.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Funções auxiliares para parsear valores
const parseEnvNumber = (envVar, defaultValue) => 
  envVar in process.env ? Number(process.env[envVar]) : defaultValue;

const parseEnvBoolean = (envVar, defaultValue) =>
  envVar in process.env ? process.env[envVar] !== 'false' : defaultValue;

// Configuração principal
export const config = {
  input: {
    videos: process.env.INPUT_VIDEOS?.split(',') || ['/Users/terabyte_7x/Documents/Projetos/edicao-automatizada/GX010069.MP4'],
    directory: process.env.INPUT_DIRECTORY || path.resolve(__dirname, '..', 'input'),
    extensions: process.env.INPUT_EXTENSIONS?.split(',') || ['mp4', 'mov', 'avi'],
    validation: {
      required: parseEnvBoolean('INPUT_VALIDATION_REQUIRED', true),
      timeout: parseEnvNumber('INPUT_VALIDATION_TIMEOUT', 5000)
    }
  },

  output: {
    directory: process.env.OUTPUT_DIRECTORY || path.resolve(__dirname, '..', 'output'),
    filenames: {
      youtube: process.env.OUTPUT_YOUTUBE_FILENAME || 'youtube_final.mov', // Alterado para .mov
      tiktok: process.env.OUTPUT_TIKTOK_FILENAME || 'tiktok_final.mov'     // Alterado para .mov
    },
    format: {
      youtube: {
        resolution: process.env.YOUTUBE_RESOLUTION || '3840x2160',
        codec: process.env.YOUTUBE_CODEC || 'prores_ks',
        profile: parseInt(process.env.YOUTUBE_PROFILE) || 3,
        pixelFormat: process.env.YOUTUBE_PIXEL_FORMAT || 'yuv422p10le',
        bitrate: process.env.YOUTUBE_BITRATE || '500M',
        fps: parseInt(process.env.YOUTUBE_FPS) || 30,
        format: 'mov' // Novo campo especificando o container
      },
      tiktok: {
        resolution: process.env.TIKTOK_RESOLUTION || '1080x1920',
        codec: process.env.TIKTOK_CODEC || 'prores_ks',
        profile: parseInt(process.env.TIKTOK_PROFILE) || 3,
        pixelFormat: process.env.TIKTOK_PIXEL_FORMAT || 'yuv422p10le',
        bitrate: process.env.TIKTOK_BITRATE === '0' ? '0' : (process.env.TIKTOK_BITRATE || '200M'),
        fps: parseInt(process.env.TIKTOK_FPS) || 30,
        format: 'mov' // Novo campo especificando o container
      }
    }
  },

  processing: {
    concurrency: {
      clipProcessing: parseEnvNumber('CONCURRENCY_CLIP', 2),
      platformExport: parseEnvNumber('CONCURRENCY_PLATFORM', 1)
    },
    retry: {
      attempts: parseEnvNumber('RETRY_ATTEMPTS', 5),
      delay: parseEnvNumber('RETRY_DELAY', 3000)
    },
    tempDirPrefix: process.env.TEMP_DIR_PREFIX || 'video-edit-',
    cleanup: {
      tempFiles: parseEnvBoolean('CLEANUP_TEMP_FILES', true),
      logs: process.env.CLEANUP_LOGS || '7d'
    }
  },

  audio: {
    silenceThreshold: parseEnvNumber('AUDIO_SILENCE_THRESHOLD', -40),
    autoDetect: parseEnvBoolean('AUDIO_AUTO_DETECT', true),
    shortDuration: parseEnvNumber('AUDIO_SHORT_DURATION', 0.8),
    longDuration: parseEnvNumber('AUDIO_LONG_DURATION', 1.0),
    normalization: parseEnvBoolean('AUDIO_NORMALIZATION', true),
    targetLevel: parseEnvNumber('AUDIO_TARGET_LEVEL', -16)
  },

  visualEffects: {
    zoomInSpeed: parseEnvNumber('ZOOM_IN_SPEED', 0.0015),
    zoomOutSpeed: parseEnvNumber('ZOOM_OUT_SPEED', 0.0015),
    zoomDuration: parseEnvNumber('ZOOM_DURATION', 125),
    zoomVariation: parseEnvNumber('ZOOM_VARIATION', 0.3),      // Novo
    maxZoomLevel: parseEnvNumber('MAX_ZOOM_LEVEL', 1.4),       // Novo
    transitionsEnabled: parseEnvBoolean('TRANSITIONS_ENABLED', true),
    transitionDuration: parseEnvNumber('TRANSITION_DURATION', 0.5)
  },

  advanced: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffmpegLogLevel: process.env.FFMPEG_LOG_LEVEL || 'info',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    ffprobeTimeout: parseEnvNumber('FFPROBE_TIMEOUT', 30000)
  },

  logging: {
    enabled: parseEnvBoolean('LOGGING_ENABLED', true),
    level: process.env.LOG_LEVEL || 'info',
    file: {
      enabled: parseEnvBoolean('LOG_FILE_ENABLED', true),
      path: process.env.LOG_FILE_PATH || path.resolve(__dirname, '..', 'logs', 'app.log'),
      maxSize: process.env.LOG_MAX_SIZE || '10MB',
      maxFiles: parseEnvNumber('LOG_MAX_FILES', 7)
    }
  }
};

// Validação ProRes (mantida da versão original)
export function validateProRes() {
  const platforms = ['youtube', 'tiktok'];
  
  platforms.forEach(platform => {
    const format = config.output.format[platform];
    
    if (format.codec === 'prores_ks') {
      if (![0, 1, 2, 3, 4].includes(format.profile)) {
        throw new Error(`[VALIDAÇÃO] Perfil ProRes inválido para ${platform}: ${format.profile}`);
      }
      if (!['yuv422p10le', 'yuv444p10le'].includes(format.pixelFormat)) {
        throw new Error(`[VALIDAÇÃO] Pixel format inválido para ${platform}: ${format.pixelFormat}`);
      }
    }
  });
}

// Validação de recursos do sistema (mantida da versão original)
export async function checkSystemResources() {
  const requiredRAM = 4 * 1024 * 1024 * 1024; // 4GB
  const freeMemory = os.freemem();
  
  if (freeMemory < requiredRAM) {
    throw new Error(`Memória insuficiente: ${freeMemory} bytes disponíveis`);
  }
}

// Função de conversão para H.264 (mantida da versão original)
export async function convertToH264(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
    .outputOptions([
      '-c:v libx264',
      '-profile:v high',
      '-preset slow',
      '-crf 23',
      '-pix_fmt yuv420p'
    ])
  });
}
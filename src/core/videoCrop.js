// src/core/videoCrop.js
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';

export class VideoCropper {
  constructor() {
    this.aspectRatios = {
      youtube: 16/9,
      tiktok: 9/16
    };
  }

  /**
   * Processa o crop final para cada plataforma
   */
  async applyPlatformCrop(inputPath, platform) {
    const outputPath = this.getOutputPath(inputPath, platform);
    const metadata = await FileUtils.getVideoMetadata(inputPath);
    
    const command = ffmpeg(inputPath)
      .on('start', cmd => Progress.log(`Iniciando crop: ${cmd}`));

    this.applyFinalOutputSettings(command, platform);
    this.applyScaling(command, metadata, platform);
    this.applyCropping(command, metadata, platform);
    command.output(outputPath);

    return this.executeCrop(command, outputPath, platform);
  }

  /**
   * Aplica configurações finais de output
   */
  applyFinalOutputSettings(command, platform) {
    const settings = config.output.format[platform];
    
    command
      .format('mov')
      .videoCodec(settings.codec)
      .audioCodec('pcm_s24le')
      .outputOptions([
        `-profile:v ${settings.profile}`,
        `-pix_fmt ${settings.pixelFormat}`,
        `-b:v ${settings.bitrate}`,
        `-r ${settings.fps}`,
        '-vendor ap10',
        '-movflags write_colr',
        '-timecode 00:00:00:00',
        '-color_primaries bt709',
        '-color_trc bt709',
        '-colorspace bt709'
      ]);
  }

  /**
   * Aplica scaling inteligente baseado no aspect ratio
   */
  applyScaling(command, metadata, platform) {
    const targetRes = config.output.format[platform].resolution.split('x');
    const [targetWidth, targetHeight] = targetRes.map(Number);
    const inputAspect = metadata.streams[0].width / metadata.streams[0].height;
    const targetAspect = this.aspectRatios[platform];

    let scaleFilter = `scale=`;
    
    if (inputAspect > targetAspect) {
      scaleFilter += `-2:${targetHeight}:flags=lanczos`;
    } else {
      scaleFilter += `${targetWidth}:-2:flags=lanczos`;
    }

    command.videoFilters(scaleFilter);
  }

  /**
   * Aplica cropping centralizado
   */
  applyCropping(command, metadata, platform) {
    const targetRes = config.output.format[platform].resolution.split('x');
    const [targetWidth, targetHeight] = targetRes.map(Number);
    
    const cropFilter = `crop=${targetWidth}:${targetHeight}:` +
      `(in_w-out_w)/2:(in_h-out_h)/2`;
    
    command.videoFilters(cropFilter);
  }

  /**
   * Executa o comando de crop com tratamento de erros
   */
  async executeCrop(command, outputPath, platform) {
    const taskId = Progress.start({
      type: 'crop',
      platform,
      context: `Aplicando crop para ${platform}`
    });

    try {
      await new Promise((resolve, reject) => {
        command
          .on('progress', Progress.ffmpegHandler(taskId))
          .on('end', () => {
            Progress.complete(taskId);
            resolve(outputPath);
          })
          .on('error', reject)
          .run();
      });

      return outputPath;
    } catch (error) {
      Progress.log(`Erro no crop: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Gera caminho de output com sufixo
   */
  getOutputPath(inputPath, platform) {
    const parsed = path.parse(inputPath);
    return path.join(
      config.output.directory,
      `${parsed.name}_${platform}_cropped.mov` // Força extensão .mov
    );
  }

  /**
   * Processamento em lote para múltiplas plataformas
   */
  async batchCrop(inputPath) {
    const platforms = Object.keys(config.output.format);
    return Promise.all(
      platforms.map(platform => this.applyPlatformCrop(inputPath, platform))
    );
  }
}

// Singleton para uso geral
export const videoCropper = new VideoCropper();
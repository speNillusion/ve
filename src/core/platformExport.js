// src/core/platformExport.js
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';
import { checkSystemResources } from '../config/config.js';

export class PlatformExporter {
  constructor() {
    this.activeProcesses = new Set();
  }

  /**
   * Exporta o vídeo final para todas as plataformas
   */
  async exportFinalVideo(processedVideoPath) {
    await checkSystemResources();
    const platforms = Object.keys(config.output.format);
    
    return Promise.all(
      platforms.map(platform => 
            this.exportForPlatform(processedVideoPath, platform)
        )
    );
  }

  /**
   * Exportação específica para cada plataforma
   */
  async exportForPlatform(inputPath, platform) {
    const outputPath = this.getOutputPath(platform);
    const command = this.createExportCommand(inputPath, platform);

    try {
      return await this.executeWithRetry(command, outputPath, platform);
    } finally {
      this.cleanupAfterExport(inputPath, platform);
    }
  }

  /**
   * Cria comando FFmpeg configurado
   */
  createExportCommand(inputPath, platform) {
    const settings = config.output.format[platform];
  
    return ffmpeg(inputPath)
      .format(settings.format) // Especifica o formato do container
      .videoCodec(settings.codec)
      .audioCodec('pcm_s24le') // Codec de áudio apropriado para ProRes
      .outputOptions([
        `-s ${settings.resolution}`,
        `-profile:v ${settings.profile}`,
        `-pix_fmt ${settings.pixelFormat}`,
        `-b:v ${settings.bitrate}`,
        `-r ${settings.fps}`,
        '-movflags write_colr' // Flag importante para ProRes
      ])
      .output(this.getOutputPath(platform));
  }

  /**
   * Executa comando com sistema de retry
   */
  async executeWithRetry(command, outputPath, platform) {
    for (let attempt = 1; attempt <= config.processing.retry.attempts; attempt++) {
      const taskId = Progress.start({
        type: 'export',
        platform,
        context: `Exportando para ${platform} (tentativa ${attempt})`
      });

      try {
        return await new Promise((resolve, reject) => {
          this.activeProcesses.add(command);

          command
            .on('progress', Progress.ffmpegHandler(taskId))
            .on('end', () => {
              this.activeProcesses.delete(command);
              Progress.complete(taskId);
              resolve(outputPath);
            })
            .on('error', (err) => {
              this.activeProcesses.delete(command);
              Progress.log(`Erro na exportação: ${err.message}`, 'error');
              reject(err);
            })
            .run();
        });
      } catch (error) {
        if (attempt === config.processing.retry.attempts) throw error;
        await new Promise(resolve => setTimeout(resolve, config.processing.retry.delay));
      }
    }
  }

  /**
   * Gera caminho de saída correto
   */
  getOutputPath(platform) {
    return path.join(
      config.output.directory,
      config.output.filenames[platform]
    );
  }

  /**
   * Limpeza pós-exportação
   */
  cleanupAfterExport(inputPath, platform) {
    if (config.processing.cleanup.tempFiles && 
        inputPath.includes(config.processing.tempDirPrefix)) {
      FileUtils.safeDelete(inputPath).catch(() => {});
    }
  }

  /**
   * Otimização para múltiplos vídeos
   */
  async batchExport(videoPaths) {
    const pool = new Map();
    
    for (const videoPath of videoPaths) {
      while (pool.size >= config.processing.concurrency.platformExport) {
        await Promise.race([...pool.values()]);
      }

      const exportPromise = this.exportFinalVideo(videoPath)
        .finally(() => pool.delete(exportPromise));

      pool.set(exportPromise, exportPromise);
    }

    return Promise.all([...pool.keys()]);
  }

  /**
   * Aborta todas as exportações em andamento
   */
  abortAllExports() {
    this.activeProcesses.forEach(process => {
      process.kill('SIGTERM');
    });
    this.activeProcesses.clear();
  }
}

// Singleton para uso geral
export const platformExporter = new PlatformExporter();
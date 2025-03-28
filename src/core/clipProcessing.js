// src/core/clipProcessing.js
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';

export class ClipProcessor {
  constructor() {
    this.activeProcesses = new Set();
  }

  /**
   * Processa um clipe individual para todas as plataformas
   */
  async processClip(clipPath) {
    try {
      // Processamento principal
      const processedClip = await this.processProRes(clipPath);
      
      // Pós-processamento
      const normalizedClip = await this.normalizeAudio(processedClip);
      const finalClip = await this.applyVisualEffects(normalizedClip);
      
      return finalClip;
    } catch (error) {
      Progress.log(`Falha no processamento do clipe: ${clipPath}`, 'error');
      throw error;
    }
  }

  /**
   * Processamento ProRes base
   */
  async processProRes(clipPath) {
    const outputPath = FileUtils.generateOutputFilename(
      path.basename(clipPath, path.extname(clipPath)) + '.mov'
    );

    const command = ffmpeg(clipPath)
      .format('mov')
      .videoCodec(config.output.format.youtube.codec)
      .audioCodec('pcm_s24le')
      .outputOptions([
        `-profile:v ${config.output.format.youtube.profile}`,
        `-pix_fmt ${config.output.format.youtube.pixelFormat}`,
        `-b:v ${config.output.format.youtube.bitrate}`,
        '-vendor ap10',
        '-movflags write_colr',
        '-timecode 00:00:00:00'
      ])
      .output(outputPath);

    return this.executeProcessing(command, outputPath, 'prores');
  }

  /**
   * Normalização de áudio profissional
   */
  async normalizeAudio(inputPath) {
    if (!config.audio.normalization) return inputPath;

    const outputPath = FileUtils.generateOutputFilename(
      `normalized_${path.basename(inputPath)}`
    );

    const command = ffmpeg(inputPath)
      .audioFilters(
        `loudnorm=I=${config.audio.targetLevel}:TP=-1.5:LRA=11:print_format=json`
      )
      .audioCodec('pcm_s24le')
      .format('mov')
      .output(outputPath);

    return this.executeProcessing(command, outputPath, 'audio');
  }

  /**
   * Aplica efeitos visuais com zoom dinâmico
   */
  async applyVisualEffects(inputPath) {
    const outputPath = FileUtils.generateOutputFilename(
      `final_${path.basename(inputPath)}`
    );

    const command = ffmpeg(inputPath)
      .videoFilters(this.createZoomFilter())
      .outputOptions([
        '-c:v prores_ks',
        '-profile:v 3',
        '-pix_fmt yuv422p10le'
      ])
      .output(outputPath);

    return this.executeProcessing(command, outputPath, 'effects');
  }

  /**
   * Cria filtro de zoom cinematográfico
   */
  createZoomFilter() {
    return `zoompan=
      z='min(zoom+${config.visualEffects.zoomInSpeed},1.2)':
      d=${config.visualEffects.zoomDuration}:
      x='iw/2-(iw/zoom/2)':
      y='ih/2-(ih/zoom/2)':
      fps=${config.output.format.youtube.fps}`;
  }

  /**
   * Executa o processamento com tratamento de erros
   */
  async executeProcessing(command, outputPath, stage) {
    for (let attempt = 1; attempt <= config.processing.retry.attempts; attempt++) {
      const taskId = Progress.start({
        type: 'clip',
        stage,
        context: `Processando ${stage} (tentativa ${attempt})`
      });

      try {
        return await new Promise((resolve, reject) => {
          this.activeProcesses.add(command);
          
          command
            .on('progress', Progress.ffmpegHandler(taskId))
            .on('end', () => {
              this.cleanupProcessing(command, taskId);
              resolve(outputPath);
            })
            .on('error', (err) => {
              this.cleanupProcessing(command, taskId);
              Progress.log(`Erro no estágio ${stage}: ${err.message}`, 'error');
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
   * Limpeza de recursos
   */
  cleanupProcessing(command, taskId) {
    this.activeProcesses.delete(command);
    Progress.complete(taskId);
    
    if (config.processing.cleanup.tempFiles) {
      FileUtils.safeDelete(command._inputs[0]).catch(() => {});
    }
  }

  /**
   * Processamento em lote paralelo
   */
  async batchProcess(clips) {
    const pool = [];
    
    for (const clip of clips) {
      while (pool.length >= config.processing.concurrency.clip) {
        await Promise.race(pool);
      }

      const task = this.processClip(clip)
        .finally(() => pool.splice(pool.indexOf(task), 1));

      pool.push(task);
      Progress.log(`Clipe adicionado ao processamento: ${path.basename(clip)}`, 'debug');
    }

    return Promise.all(pool);
  }
}

// Singleton para uso geral
export const clipProcessor = new ClipProcessor();
// src/utils/ffmpegUtils.js
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config/config.js';
import { Progress } from './progressBar.js';
import { FileUtils } from './fileUtils.js';
import { checkSystemResources, validateProRes } from '../config/config.js';

export class FFmpegProcessor {
  constructor() {
    this.setFFmpegPaths();
    validateProRes();
  }

  setFFmpegPaths() {
    ffmpeg.setFfmpegPath(config.advanced.ffmpegPath);
    ffmpeg.setFfprobePath(config.advanced.ffprobePath);
  }

  /**
   * Cria instância FFmpeg com configurações padrão
   */
  createBaseCommand(inputPath) {
    return ffmpeg(inputPath)
      .audioQuality(0)
      .audioChannels(2)
      .outputOptions('-hide_banner')
      .outputOptions('-max_muxing_queue_size 9999')
      .outputOptions('-strict -2');
  }

  /**
   * Aplica configurações de codec ProRes
   */
  applyProResSettings(command, platform) {
    const settings = config.output.format[platform];
    
    return command
      .format(settings.format)
      .videoCodec(settings.codec)
      .audioCodec('pcm_s24le')
      .outputOptions([
        `-profile:v ${settings.profile}`,
        `-pix_fmt ${settings.pixelFormat}`,
        `-vf scale=${settings.resolution}:flags=spline+accurate_rnd+full_chroma_int`,
        `-r ${settings.fps}`,
        `-b:v ${settings.bitrate}`,
        '-movflags write_colr',
        '-color_primaries bt709',
        '-color_trc bt709',
        '-colorspace bt709'
      ]);
  }

  /**
   * Processamento completo para uma plataforma
   */
  async processForPlatform(inputPaths, platform) {
    await checkSystemResources();
    const outputPath = FileUtils.generateOutputFilename(
      config.output.filenames[platform], 
      platform
    );

    const command = this.createBaseCommand(inputPaths)
      .output(outputPath)
      .on('start', cmd => Progress.log(`Iniciando processamento: ${cmd}`))
      .on('stderr', (line) => console.error('FFmpeg stderr:', line))
      .on('error', err => Progress.log(`Erro FFmpeg: ${err.message}`, 'error'))
      .on('end', () => this.handleProcessEnd(outputPath, platform));

    this.applyProResSettings(command, platform);
    this.applyAudioProcessing(command);
    this.applyVisualEffects(command);

    return this.executeCommand(command, platform);
  }

  /**
   * Aplica efeitos visuais configurados
   */
  applyVisualEffects(command) {
    if (config.visualEffects.transitionsEnabled) {
      this.applyTransitions(command);
    }
    
    if (config.visualEffects.zoomInSpeed > 0) {
      this.applyZoomEffect(command);
    }
  }

  /**
   * Efeito de zoom dinâmico
   */
  applyZoomEffect(command) {
    const zoomFilter = `
      zoompan=
        z='min(zoom+${config.visualEffects.zoomInSpeed},1.5)':
        d=${config.visualEffects.zoomDuration}:
        fps=${config.output.format.youtube.fps}
    `;

    command.videoFilters(zoomFilter);
  }

  /**
   * Aplica transições entre clipes
   */
  applyTransitions(command) {
    command.complexFilter([
      '[0:v][1:v]xfade=transition=slideleft:duration=0.5[outv]',
      '[0:a][1:a]acrossfade=d=0.5[outa]'
    ], ['outv', 'outa']);
  }

  /**
   * Processamento de áudio
   */
  applyAudioProcessing(command) {
    if (config.audio.normalization) {
      command.audioFilters(
        `loudnorm=I=${config.audio.targetLevel}:TP=-1.5:LRA=11`
      );
    }
  }

  /**
   * Executa comando com tratamento de erros e retry
   */
  async executeCommand(command, platform, outputPath) { // outputPath agora é parâmetro
    const taskId = Progress.start({
      type: 'ffmpeg',
      color: Progress.progressColors[platform],
      context: `Processando para ${platform}`
    });

    try {
      return await new Promise((resolve, reject) => {
        command
          .on('progress', Progress.ffmpegHandler(taskId))
          .on('end', () => {
            Progress.complete(taskId);
            resolve(outputPath); // Usa o outputPath recebido
          })
          // ... (restante do código)
      });
    } catch (error) {
      if (config.processing.retry.attempts > 0) {
        return this.retryProcessing(inputPaths, platform, outputPath); // Passa parâmetros necessários
      }
      throw error;
    }
  }

  async retryProcessing(command, platform, taskId) {
    for (let i = 0; i < config.processing.retry.attempts; i++) {
      try {
        const command = this.createBaseCommand(inputPaths)
          .output(outputPath)
        return await this.executeCommand(command, platform, outputPath);
      } catch (error) {
        if (i === config.processing.retry.attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, config.processing.retry.delay));
      }
    }
  }

  /**
   * Pós-processamento
   */
  handleProcessEnd(outputPath, platform) {
    Progress.log(`Arquivo ${platform} finalizado: ${outputPath}`, 'success');
    if (config.processing.cleanup.tempFiles) {
      FileUtils.cleanupTempFiles();
    }
  }

  /**
   * Renderização paralela
   */
  async parallelProcessing(inputPaths) {
    const youtubeTask = this.processForPlatform(inputPaths, 'youtube');
    const tiktokTask = this.processForPlatform(inputPaths, 'tiktok');
    return Promise.all([youtubeTask, tiktokTask]);
  }
}

// Utilitários de ProRes
export const ProResUtils = {
  async validateProResFile(filePath) {
    const metadata = await FileUtils.getVideoMetadata(filePath);
    return metadata.streams.some(stream => 
      stream.codec_name === 'prores' &&
      stream.profile === config.output.format.youtube.profile.toString()
    );
  },

  generateProResMetadata() {
    return {
      encoder: `FFmpeg ProRes HQ (Profile ${config.output.format.youtube.profile})`,
      creationTime: new Date().toISOString(),
      targetPlatforms: Object.keys(config.output.format)
    };
  }
};

// Singleton para uso geral
export const ffmpegProcessor = new FFmpegProcessor();
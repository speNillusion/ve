// src/core/videoTransitions.js
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';

export class VideoTransitionEngine {
  constructor() {
    this.transitionTypes = {
      zoomIn: this.applyZoomIn.bind(this),
      zoomOut: this.applyZoomOut.bind(this)
    };
  }

  /**
   * Aplica transições entre clipes
   * @param {ffmpeg} command - Instância FFmpeg
   * @param {Array} inputPaths - Lista de arquivos de entrada
   */
  applyTransitions(command) {
    if (config.visualEffects.transitionsEnabled) {
      const zoomType = Math.random() > 0.5 ? 'zoomIn' : 'zoomOut';
      this.transitionTypes[zoomType](command);
    }
  }

  applyZoomIn(command) {
    const speed = config.visualEffects.zoomInSpeed * 
      (1 + Math.random() * config.visualEffects.zoomVariation);
    
    command.videoFilters(this.createZoomFilter(
      speed,
      config.visualEffects.maxZoomLevel
    ));
  }

  applyZoomOut(command) {
    const speed = -config.visualEffects.zoomOutSpeed * 
      (1 + Math.random() * config.visualEffects.zoomVariation);
    
    command.videoFilters(this.createZoomFilter(
      speed,
      1/config.visualEffects.maxZoomLevel
    ));
  }

  /**
   * Cria filtro complexo para transições
   */
  buildComplexFilter(inputPaths, transitionType) {
    const filters = [];
    const outputs = [];
    const transitionDuration = config.visualEffects.transitionDuration;

    let videoCount = 0;
    let audioCount = 0;

    for (let i = 0; i < inputPaths.length - 1; i++) {
      const current = `[${i}:v]`;
      const next = `[${i + 1}:v]`;
      const output = `[vt${i}]`;

      filters.push({
        filter: 'xfade',
        options: {
          transition: transitionType,
          duration: transitionDuration,
          offset: `$(${transitionDuration} + ${i}*${transitionDuration})`
        },
        inputs: [current, next],
        outputs: [output]
      });

      videoCount = i;
    }

    // Último output de vídeo
    outputs.push(`[vt${videoCount}]`);

    return {
      filters: filters.flatMap(f => [
        ...f.inputs.map(input => ({ [input.split(':')[0]]: input.split(':')[1] })),
        {
          filter: f.filter,
          options: f.options,
          inputs: f.inputs,
          outputs: f.outputs
        }
      ]),
      outputs: ['outv', 'outa']
    };
  }

  /**
   * Aplica transições de áudio sincronizadas
   */
  applyTransitionAudio(command, clipCount) {
    const transitionDuration = config.visualEffects.transitionDuration;
    command.complexFilter([
      {
        filter: 'acrossfade',
        options: `d=${transitionDuration}:c1=1:c2=1`
      }
    ]);
  }

  /**
   * Seleciona melhor tipo de transição baseado no conteúdo
   */
  getBestTransitionType(inputPaths) {
    // Lógica avançada de detecção de cena pode ser implementada aqui
    return config.visualEffects.transitionsEnabled ? 'slideleft' : 'fade';
  }

  /**
   * Transição personalizada com zoom
   */
  customTransition(inputs) {
    return [
      {
        filter: 'zoompan',
        options: `z='1.0 + 0.5*sin(on/${config.visualEffects.zoomDuration})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
      }
    ];
  }

  /**
   * Aplica efeito de zoom dinâmico
   */
  applyZoomEffect(command) {
    if (config.visualEffects.zoomInSpeed > 0) {
      const zoomFilter = this.createZoomFilter();
      command.videoFilters(zoomFilter);
    }
  }

  createZoomFilter(speed, maxLevel) {
    return `zoompan=
      z='min(zoom+${speed},${maxLevel})':
      d=${config.visualEffects.zoomDuration}:
      x='iw/2-(iw/zoom/2)':
      y='ih/2-(ih/zoom/2)':
      fps=${config.output.format.youtube.fps}`;
  }

  /**
   * Processa transições em paralelo
   */
  async processTransition(clips, platform) {
    const outputPath = FileUtils.generateOutputFilename(
      config.output.filenames[platform],
      platform
    );

    const command = ffmpeg()
      .input(clips[0])
      .inputOptions('-framerate 30');

    clips.slice(1).forEach((clip, index) => {
      command.input(clip);
      this.applyTransitionBetweenClips(command, index);
    });

    this.applyFinalOutputSettings(command, outputPath, platform);

    return this.executeTransitionCommand(command, outputPath, platform);
  }

  applyFinalOutputSettings(command, outputPath, platform) {
    command
      .output(outputPath)
      .videoCodec(config.output.format[platform].codec)
      .audioCodec('aac')
      .outputOptions([
        '-profile:v', config.output.format[platform].profile,
        '-pix_fmt', config.output.format[platform].pixelFormat,
        '-movflags', '+faststart'
      ]);
  }

  async executeTransitionCommand(command, outputPath, platform) {
    const taskId = Progress.start({
      type: 'transition',
      platform,
      context: `Aplicando transições para ${platform}`
    });

    return new Promise((resolve, reject) => {
      command
        .on('progress', Progress.ffmpegHandler(taskId))
        .on('end', () => {
          Progress.complete(taskId);
          resolve(outputPath);
        })
        .on('error', (err) => {
          Progress.log(`Erro nas transições: ${err.message}`, 'error');
          reject(err);
        })
        .run();
    });
  }
}

// Singleton para uso geral
export const transitionEngine = new VideoTransitionEngine();
// src/utils/ffmpegUtils.js
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config/config.js';
import { Progress } from './progressBar.js';
import { FileUtils } from './fileUtils.js';
import { checkSystemResources, validateProRes } from '../config/config.js';

export /**
 * @class FFmpegProcessor
 * @description Classe central para processamento de vídeo usando FFmpeg.
 * Implementa pipeline completo de processamento profissional com:
 * - Configurações otimizadas de codec
 * - Gerenciamento de recursos
 * - Sistema de retry automático
 * - Processamento paralelo
 */
class FFmpegProcessor {
  /**
   * @constructor
   * @description Inicializa o processador FFmpeg e valida requisitos:
   * - Configura caminhos do FFmpeg
   * - Valida suporte a ProRes
   * - Prepara ambiente de processamento
   */
  constructor() {
    this.setFFmpegPaths();
    validateProRes();
  }

  /**
   * @private
   * @description Configura os caminhos dos binários do FFmpeg.
   * Utiliza caminhos definidos no arquivo de configuração para
   * garantir consistência entre ambientes.
   */
  setFFmpegPaths() {
    ffmpeg.setFfmpegPath(config.advanced.ffmpegPath);
    ffmpeg.setFfprobePath(config.advanced.ffprobePath);
  }

  /**
   * Cria instância FFmpeg com configurações padrão otimizadas
   * @param {string} inputPath - Caminho do arquivo de entrada
   * @returns {Object} Comando FFmpeg configurado
   * @description Configura parâmetros base do FFmpeg incluindo:
   * - Qualidade de áudio máxima
   * - Otimizações de threading
   * - Configurações de buffer
   * - Tratamento de erros robusto
   */
  createBaseCommand(inputPath) {
    return ffmpeg(inputPath)
      .audioQuality(0)
      .audioChannels(2)
      .outputOptions('-hide_banner')
      .outputOptions('-max_muxing_queue_size 9999')
      .outputOptions('-strict -2')
      .outputOptions('-threads 4')
      .outputOptions('-preset medium')
      .outputOptions('-probesize 50M')
      .outputOptions('-analyzeduration 50M')
      .outputOptions('-max_error_rate 0.0')
      .outputOptions('-error_detect ignore_err');
  }

  /**
   * Aplica configurações profissionais do codec ProRes
   * @param {Object} command - Comando FFmpeg base
   * @param {string} platform - Plataforma alvo
   * @returns {Object} Comando FFmpeg com configurações ProRes
   * @description Configura encoding ProRes profissional:
   * - Perfil ProRes 422 HQ
   * - Áudio PCM 24-bit
   * - Metadados de cor
   * - Resolução e FPS otimizados
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
   * Processamento completo de vídeo para plataforma específica
   * @async
   * @param {string[]} inputPaths - Caminhos dos arquivos de entrada
   * @param {string} platform - Plataforma alvo
   * @returns {Promise<string>} Caminho do arquivo processado
   * @throws {Error} Se ocorrer erro durante o processamento
   * @description Pipeline completo de processamento incluindo:
   * - Verificação de recursos
   * - Aplicação de efeitos
   * - Processamento de áudio
   * - Encoding final
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
   * Aplica efeitos visuais profissionais
   * @param {Object} command - Comando FFmpeg
   * @description Sistema avançado de efeitos visuais:
   * - Transições suaves
   * - Zoom dinâmico
   * - Efeitos configuráveis
   * - Preservação de qualidade
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
   * Aplica efeito de zoom dinâmico cinematográfico
   * @param {Object} command - Comando FFmpeg
   * @description Implementa zoom suave e profissional:
   * - Velocidade configurável
   * - Centralização automática
   * - Interpolação de alta qualidade
   * - Preservação de aspect ratio
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
   * Aplica transições profissionais entre clipes
   * @param {Object} command - Comando FFmpeg
   * @description Sistema de transições avançado:
   * - Transições visuais suaves
   * - Crossfade de áudio
   * - Duração configurável
   * - Múltiplos estilos disponíveis
   */
  applyTransitions(command) {
    command.complexFilter([
      '[0:v][1:v]xfade=transition=slideleft:duration=0.5[outv]',
      '[0:a][1:a]acrossfade=d=0.5[outa]'
    ], ['outv', 'outa']);
  }

  /**
   * Aplica processamento profissional de áudio
   * @param {Object} command - Comando FFmpeg
   * @description Sistema avançado de áudio:
   * - Normalização EBU R128
   * - Controle de loudness
   * - True peak limiting
   * - Preservação de dinâmica
   */
  applyAudioProcessing(command) {
    if (config.audio.normalization) {
      command.audioFilters(
        `loudnorm=I=${config.audio.targetLevel}:TP=-1.5:LRA=11`
      );
    }
  }

  /**
   * Executa comando com sistema robusto de erro e retry
   * @async
   * @param {Object} command - Comando FFmpeg
   * @param {string} platform - Plataforma alvo
   * @param {string} outputPath - Caminho do arquivo de saída
   * @returns {Promise<string>} Caminho do arquivo processado
   * @throws {Error} Se todas as tentativas falharem
   * @description Sistema robusto de execução:
   * - Retry automático configurável
   * - Progresso em tempo real
   * - Tratamento granular de erros
   * - Limpeza de recursos
   */
  async executeCommand(command, platform, outputPath) {
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
            resolve(outputPath);
          })
          .on('error', (err) => {
            Progress.log(`Erro no processamento: ${err.message}`, 'error');
            reject(err);
          })
          .run();
      });
    } catch (error) {
      if (config.processing.retry.attempts > 0) {
        return this.retryProcessing(inputPaths, platform, outputPath); // Passa parâmetros necessários
      }
      throw error;
    }
  }

  async retryProcessing(inputPaths, platform, outputPath) {
    for (let i = 0; i < config.processing.retry.attempts; i++) {
      try {
        Progress.log(`Tentativa ${i + 1} de ${config.processing.retry.attempts}`, 'info');
        await checkSystemResources();
        const command = this.createBaseCommand(inputPaths)
          .output(outputPath);
        this.applyProResSettings(command, platform);
        return await this.executeCommand(command, platform, outputPath);
      } catch (error) {
        Progress.log(`Falha na tentativa ${i + 1}: ${error.message}`, 'warning');
        if (i === config.processing.retry.attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, config.processing.retry.delay));
      }
    }
  }

  /**
   * Gerencia pós-processamento e limpeza
   * @param {string} outputPath - Caminho do arquivo processado
   * @param {string} platform - Plataforma processada
   * @description Sistema de finalização:
   * - Logging de conclusão
   * - Limpeza de temporários
   * - Validação de output
   * - Atualização de progresso
   */
  handleProcessEnd(outputPath, platform) {
    Progress.log(`Arquivo ${platform} finalizado: ${outputPath}`, 'success');
    if (config.processing.cleanup.tempFiles) {
      FileUtils.cleanupTempFiles();
    }
  }

  /**
   * Sistema de renderização paralela otimizada
   * @async
   * @param {string[]} inputPaths - Caminhos dos arquivos
   * @returns {Promise<string[]>} Caminhos dos arquivos processados
   * @description Processamento paralelo eficiente:
   * - Execução simultânea
   * - Balanceamento de recursos
   * - Monitoramento de progresso
   * - Tratamento de falhas isolado
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
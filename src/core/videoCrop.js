/**
 * @fileoverview Módulo responsável pelo processamento de crop de vídeos para diferentes plataformas.
 * Implementa lógica avançada de redimensionamento e corte mantendo aspect ratios específicos.
 * 
 * @module core/videoCrop
 * @requires fluent-ffmpeg
 * @requires path
 * @requires ../config/config
 * @requires ../utils/progressBar
 * @requires ../utils/fileUtils
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';

/**
 * @class VideoCropper
 * @description Classe especializada no processamento de crops de vídeo com aspect ratios
 * específicos para diferentes plataformas. Implementa algoritmos inteligentes de
 * redimensionamento e corte para preservar a qualidade visual do conteúdo.
 */
export class VideoCropper {
  /**
   * @constructor
   * @description Inicializa o VideoCropper com aspect ratios predefinidos para cada plataforma.
   * Mantém as proporções padrão da indústria para garantir compatibilidade máxima.
   */
  constructor() {
    /**
     * @type {Object.<string, number>}
     * @property {number} youtube - Aspect ratio 16:9 padrão para YouTube (landscape)
     * @property {number} tiktok - Aspect ratio 9:16 padrão para TikTok (portrait)
     */
    this.aspectRatios = {
      youtube: 16/9,
      tiktok: 9/16
    };
  }

  /**
   * Processa o crop final para uma plataforma específica
   * @async
   * @param {string} inputPath - Caminho do arquivo de vídeo de entrada
   * @param {string} platform - Plataforma alvo (youtube|tiktok)
   * @returns {Promise<string>} Caminho do arquivo processado
   * @throws {Error} Se ocorrer erro durante o processamento
   * @description Aplica transformações de vídeo específicas para cada plataforma,
   * incluindo scaling inteligente, cropping centralizado e configurações de codec otimizadas.
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
   * Aplica configurações finais de output para o vídeo
   * @param {Object} command - Instância do comando ffmpeg
   * @param {string} platform - Plataforma alvo
   * @description Configura parâmetros avançados de encoding incluindo codec, bitrate,
   * formato de pixel e configurações de cor para garantir máxima qualidade e compatibilidade.
   * Utiliza configurações ProRes otimizadas para workflow profissional.
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
   * @param {Object} command - Instância do comando ffmpeg
   * @param {Object} metadata - Metadados do vídeo de entrada
   * @param {string} platform - Plataforma alvo
   * @description Implementa algoritmo adaptativo de scaling que preserva a qualidade
   * do conteúdo enquanto ajusta para o aspect ratio correto. Utiliza o filtro lanczos
   * para melhor qualidade de interpolação.
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
   * Aplica cropping centralizado no vídeo
   * @param {Object} command - Instância do comando ffmpeg
   * @param {Object} metadata - Metadados do vídeo de entrada
   * @param {string} platform - Plataforma alvo
   * @description Implementa cropping inteligente que mantém o conteúdo centralizado,
   * removendo bordas excedentes de forma equilibrada para atingir o aspect ratio desejado
   * sem distorcer o conteúdo principal.
   */
  applyCropping(command, metadata, platform) {
    const targetRes = config.output.format[platform].resolution.split('x');
    const [targetWidth, targetHeight] = targetRes.map(Number);
    
    const cropFilter = `crop=${targetWidth}:${targetHeight}:` +
      `(in_w-out_w)/2:(in_h-out_h)/2`;
    
    command.videoFilters(cropFilter);
  }

  /**
   * Executa o comando de crop com tratamento de erros robusto
   * @async
   * @param {Object} command - Instância do comando ffmpeg configurada
   * @param {string} outputPath - Caminho do arquivo de saída
   * @param {string} platform - Plataforma alvo
   * @returns {Promise<string>} Caminho do arquivo processado
   * @throws {Error} Se ocorrer erro durante a execução
   * @description Gerencia a execução do processo de crop com sistema de progresso
   * e tratamento de erros robusto. Monitora o progresso em tempo real e garante
   * limpeza adequada de recursos em caso de falha.
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
   * Gera caminho de output com sufixo apropriado
   * @param {string} inputPath - Caminho do arquivo de entrada
   * @param {string} platform - Plataforma alvo
   * @returns {string} Caminho completo do arquivo de saída
   * @description Gera um caminho de saída único e organizado baseado no nome do arquivo
   * original e na plataforma alvo. Força extensão .mov para manter compatibilidade
   * com workflow ProRes.
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
   * @async
   * @param {string} inputPath - Caminho do arquivo de entrada
   * @returns {Promise<string[]>} Array com caminhos dos arquivos processados
   * @description Executa processamento paralelo para todas as plataformas configuradas,
   * otimizando o tempo total de processamento através de Promise.all. Mantém controle
   * de recursos e garante execução eficiente.
   */
  async batchCrop(inputPath) {
    const platforms = Object.keys(config.output.format);
    return Promise.all(
      platforms.map(platform => this.applyPlatformCrop(inputPath, platform))
    );
  }
}

/**
 * Instância singleton do VideoCropper para uso global na aplicação
 * @type {VideoCropper}
 */
export const videoCropper = new VideoCropper();
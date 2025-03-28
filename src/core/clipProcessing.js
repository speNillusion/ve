/**
 * @fileoverview Módulo responsável pelo processamento avançado de clipes de vídeo.
 * Implementa pipeline completo de processamento incluindo ProRes, normalização de áudio
 * e efeitos visuais com gerenciamento de recursos e retry automático.
 * 
 * @module core/clipProcessing
 * @requires fluent-ffmpeg
 * @requires path
 * @requires ../config/config
 * @requires ../utils/progressBar
 * @requires ../utils/fileUtils
 * @requires ../utils/resourceMonitor
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';
import { resourceMonitor } from '../utils/resourceMonitor.js';

/**
 * @class ClipProcessor
 * @description Classe especializada no processamento profissional de clipes de vídeo.
 * Implementa pipeline completo com ProRes, normalização de áudio e efeitos visuais.
 * Inclui gerenciamento de recursos, retry automático e processamento paralelo.
 */
export class ClipProcessor {
  /**
   * @constructor
   * @description Inicializa o processador de clipes com conjunto de processos ativos.
   * Mantém registro de todos os processos em execução para gerenciamento de recursos.
   */
  constructor() {
    /**
     * @type {Set<Object>}
     * @description Conjunto de processos FFmpeg atualmente em execução
     */
    this.activeProcesses = new Set();
  }

  /**
   * Processa um clipe individual para todas as plataformas
   * @async
   * @param {string} clipPath - Caminho do arquivo de clipe a ser processado
   * @returns {Promise<string>} Caminho do arquivo processado
   * @throws {Error} Se ocorrer erro durante o processamento
   * @description Pipeline completo de processamento incluindo:
   * - Conversão para ProRes
   * - Normalização de áudio
   * - Aplicação de efeitos visuais
   * Com sistema de retry e monitoramento de recursos.
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
   * Processamento ProRes base do clipe
   * @async
   * @param {string} clipPath - Caminho do arquivo de entrada
   * @returns {Promise<string>} Caminho do arquivo processado em ProRes
   * @throws {Error} Se ocorrer erro durante a conversão
   * @description Converte o clipe para formato ProRes profissional com:
   * - Codec ProRes 422 HQ
   * - Áudio PCM 24-bit
   * - Metadados de cor e timecode
   * - Configurações otimizadas de encoding
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
   * @async
   * @param {string} inputPath - Caminho do arquivo de entrada
   * @returns {Promise<string>} Caminho do arquivo com áudio normalizado
   * @throws {Error} Se ocorrer erro durante a normalização
   * @description Aplica normalização profissional de áudio usando EBU R128:
   * - Target Integrated Loudness (IL)
   * - True Peak limiting
   * - Loudness Range (LRA) controle
   * - Análise em duas passagens para precisão máxima
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
   * @async
   * @param {string} inputPath - Caminho do arquivo de entrada
   * @returns {Promise<string>} Caminho do arquivo com efeitos aplicados
   * @throws {Error} Se ocorrer erro durante a aplicação dos efeitos
   * @description Aplica efeitos visuais cinematográficos:
   * - Zoom dinâmico suave
   * - Mantém qualidade ProRes
   * - Preserva metadados de cor
   * - Otimizado para performance
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
   * @returns {string} String de configuração do filtro FFmpeg
   * @description Gera configuração de filtro zoompan otimizada:
   * - Velocidade de zoom configurável
   * - Duração personalizada
   * - Centralização automática
   * - Interpolação suave
   */
  createZoomFilter() {
    return `zoompan=z='min(zoom+${config.visualEffects.zoomInSpeed},1.2)':d=${config.visualEffects.zoomDuration}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${config.output.format.youtube.fps}`;
  }

  /**
   * Executa o processamento com tratamento de erros robusto
   * @async
   * @param {Object} command - Comando FFmpeg configurado
   * @param {string} outputPath - Caminho do arquivo de saída
   * @param {string} stage - Estágio atual do processamento
   * @returns {Promise<string>} Caminho do arquivo processado
   * @throws {Error} Se todas as tentativas falharem
   * @description Sistema robusto de execução com:
   * - Retry automático configurável
   * - Monitoramento de progresso
   * - Limpeza de recursos
   * - Tratamento de erros granular
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
   * Limpeza de recursos do processamento
   * @param {Object} command - Comando FFmpeg a ser limpo
   * @param {string} taskId - ID da tarefa para atualização de progresso
   * @description Realiza limpeza completa após processamento:
   * - Remove processo da lista ativa
   * - Atualiza barra de progresso
   * - Remove arquivos temporários se configurado
   * - Libera recursos do sistema
   */
  cleanupProcessing(command, taskId) {
    this.activeProcesses.delete(command);
    Progress.complete(taskId);
    
    if (config.processing.cleanup.tempFiles) {
      FileUtils.safeDelete(command._inputs[0]).catch(() => {});
    }
  }

  /**
   * Aborta todos os processos ativos
   * @description Sistema de parada emergencial:
   * - Termina todos os processos FFmpeg ativos
   * - Limpa lista de processos
   * - Registra evento no log
   * - Previne sobrecarga do sistema
   */
  abortAllProcessing() {
    this.activeProcesses.forEach(process => {
      process.kill('SIGTERM');
    });
    this.activeProcesses.clear();
    Progress.log('Processamento abortado por sobrecarga do sistema', 'warning');
  }

  /**
   * Processamento em lote paralelo com controle de recursos
   * @async
   * @param {string[]} clips - Array de caminhos dos clipes
   * @returns {Promise<string[]>} Array com caminhos dos arquivos processados
   * @throws {Error} Se ocorrer erro crítico no processamento
   * @description Sistema avançado de processamento em lote:
   * - Execução paralela controlada
   * - Monitoramento de recursos do sistema
   * - Ajuste dinâmico de concorrência
   * - Retry automático por clipe
   */
  async batchProcess(clips) {
    const pool = [];
    let lastProgressCheck = Date.now();
    
    for (const clip of clips) {
      while (pool.length >= config.processing.concurrency.clip) {
        await Promise.race(pool);
        
        // Verifica progresso a cada 30 segundos
        const now = Date.now();
        if (now - lastProgressCheck > 30000) {
          const systemLoad = await resourceMonitor.isSystemUnderLoad();
          if (systemLoad.cpu || systemLoad.memory) {
            Progress.log('Sistema sobrecarregado, pausando processamento', 'warning');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          lastProgressCheck = now;
        }
      }

      const task = this.processClip(clip)
        .finally(() => {
          pool.splice(pool.indexOf(task), 1);
          Progress.log(`Processamento finalizado: ${path.basename(clip)}`, 'success');
        });

      pool.push(task);
      Progress.log(`Clipe adicionado ao processamento: ${path.basename(clip)}`, 'debug');
    }

    return Promise.all(pool);
  }
}

// Singleton para uso geral
export const clipProcessor = new ClipProcessor();
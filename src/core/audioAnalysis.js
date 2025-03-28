// src/core/audioAnalysis.js
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config/config.js';
import { getFfmpegInstance } from '../utils/ffmpegUtils.js';
import path from 'path';
import { temporaryFile } from 'tempy';
import { readFile, unlink } from 'fs/promises';

export class AudioAnalyzer {
  constructor() {
    this.ffmpeg = getFfmpegInstance();
    this.silenceThreshold = config.audio.silenceThreshold;
    this.normalizationTarget = config.audio.targetLevel;
  }

  /**
   * Analisa o áudio e detecta segmentos de silêncio
   * @param {string} inputPath - Caminho do arquivo de entrada
   * @returns {Promise<Array>} Array de segmentos de silêncio {start, end, duration}
   */
  async detectSilence(inputPath) {
    try {
      const tempLog = temporaryFile({ extension: 'log' });
      const args = [
        '-hide_banner',
        '-nostats',
        `-i "${inputPath}"`,
        '-af',
        `silencedetect=noise=${this.silenceThreshold}dB:d=${config.audio.shortDuration}`,
        '-f null',
        '-'
      ];

      await new Promise((resolve, reject) => {
        this.ffmpeg(inputPath)
          .audioFilters(`silencedetect=noise=${this.silenceThreshold}dB:d=${config.audio.shortDuration}`)
          .outputOptions('-f null')
          .addOutput('-')
          .on('error', reject)
          .on('end', resolve)
          .save(tempLog);
      });

      const logContent = await readFile(tempLog, 'utf8');
      await unlink(tempLog);

      return this.parseSilenceDetection(logContent);
    } catch (error) {
      throw new Error(`Falha na detecção de silêncio: ${error.message}`);
    }
  }

  /**
   * Normaliza o áudio usando EBU R128 standard
   * @param {string} inputPath - Caminho de entrada
   * @param {string} outputPath - Caminho de saída
   * @returns {Promise<Object>} Resultado da normalização
   */
  async normalizeAudio(inputPath, outputPath) {
    if (!config.audio.normalization) {
      return { skipped: true };
    }

    try {
      const analysis = await this.analyzeLoudness(inputPath);
      
      return new Promise((resolve, reject) => {
        this.ffmpeg(inputPath)
          .audioFilters(
            `loudnorm=I=${this.normalizationTarget}:TP=-1.5:LRA=11:print_format=json`
          )
          .output(outputPath)
          .on('error', reject)
          .on('end', () => resolve(analysis))
          .run();
      });
    } catch (error) {
      throw new Error(`Falha na normalização do áudio: ${error.message}`);
    }
  }

  /**
   * Analisa características de loudness do áudio
   * @param {string} inputPath - Caminho do arquivo
   * @returns {Promise<Object>} Dados de loudness
   */
  async analyzeLoudness(inputPath) {
    try {
      const tempFile = temporaryFile({ extension: 'json' });
      
      await new Promise((resolve, reject) => {
        this.ffmpeg(inputPath)
          .audioFilters(
            `loudnorm=I=${this.normalizationTarget}:TP=-1.5:LRA=11:print_format=json`
          )
          .outputOptions('-f null')
          .addOutput(tempFile)
          .on('error', reject)
          .on('end', resolve)
          .run();
      });

      const data = JSON.parse(await readFile(tempFile, 'utf8'));
      await unlink(tempFile);

      return {
        integratedLoudness: data.input_i,
        loudnessRange: data.input_lra,
        truePeak: data.input_tp,
        threshold: data.input_thresh
      };
    } catch (error) {
      throw new Error(`Falha na análise de loudness: ${error.message}`);
    }
  }

  /**
   * Detecta clipping e distorção no áudio
   * @param {string} inputPath - Caminho do arquivo
   * @returns {Promise<Object>} Resultado da análise
   */
  async detectClipping(inputPath) {
    try {
      const tempLog = temporaryFile({ extension: 'log' });
      let clippingCount = 0;

      await new Promise((resolve, reject) => {
        this.ffmpeg(inputPath)
          .audioFilters('astats=measure_perchannel=none:measure_overall=1')
          .outputOptions('-f null')
          .addOutput('-')
          .on('stderr', (stderr) => {
            if (stderr.includes('clipping')) clippingCount++;
          })
          .on('error', reject)
          .on('end', resolve)
          .save(tempLog);
      });

      return {
        clippingDetected: clippingCount > 0,
        clippingCount,
        message: clippingCount > 0 ? 
          `Detectado ${clippingCount} ocorrências de clipping` : 
          'Nenhum clipping detectado'
      };
    } catch (error) {
      throw new Error(`Falha na detecção de clipping: ${error.message}`);
    }
  }

  /**
   * Auto-detecta problemas de áudio combinando múltiplas análises
   * @param {string} inputPath - Caminho do arquivo
   * @returns {Promise<Object>} Relatório completo
   */
  async autoDetectAudioIssues(inputPath) {
    const [silence, loudness, clipping] = await Promise.all([
      this.detectSilence(inputPath),
      this.analyzeLoudness(inputPath),
      this.detectClipping(inputPath)
    ]);

    const issues = [];
    
    // Analisar silêncios problemáticos
    silence.forEach(segment => {
      if (segment.duration > config.audio.longDuration) {
        issues.push({
          type: 'long_silence',
          start: segment.start,
          end: segment.end,
          duration: segment.duration
        });
      }
    });

    // Verificar níveis de loudness
    if (loudness.integratedLoudness < (this.normalizationTarget - 3)) {
      issues.push({
        type: 'low_loudness',
        value: loudness.integratedLoudness,
        target: this.normalizationTarget
      });
    }

    // Adicionar informações de clipping
    if (clipping.clippingDetected) {
      issues.push({
        type: 'clipping',
        count: clipping.clippingCount
      });
    }

    return {
      issues,
      metadata: {
        duration: await this.getAudioDuration(inputPath),
        ...loudness,
        ...clipping
      },
      suggestions: this.generateSuggestions(issues)
    };
  }

  /**
   * Gera sugestões com base nos problemas detectados
   * @param {Array} issues - Lista de problemas
   * @returns {Array} Sugestões de correção
   */
  generateSuggestions(issues) {
    return issues.map(issue => {
      switch (issue.type) {
        case 'long_silence':
          return `Cortar silêncio longo de ${issue.duration.toFixed(2)}s entre ${issue.start.toFixed(2)}s e ${issue.end.toFixed(2)}s`;
        case 'low_loudness':
          return `Aumentar ganho em ${(config.audio.targetLevel - issue.value).toFixed(1)}dB`;
        case 'clipping':
          return `Reduzir ganho para evitar clipping (${issue.count} ocorrências)`;
        default:
          return 'Ajustes gerais de áudio recomendados';
      }
    });
  }

  /**
   * Obtém a duração do áudio
   * @param {string} inputPath - Caminho do arquivo
   * @returns {Promise<number>} Duração em segundos
   */
  async getAudioDuration(inputPath) {
    return new Promise((resolve, reject) => {
      this.ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });
  }

  /**
   * Analisa o conteúdo de áudio para detectar partes com voz
   * @param {string} inputPath - Caminho do arquivo
   * @returns {Promise<Array>} Segmentos com voz detectada
   */
  async detectSpeechSegments(inputPath) {
    // Implementação complexa que pode usar modelos ML
    // Versão simplificada para demonstração:
    const silence = await this.detectSilence(inputPath);
    return this.invertSilenceSegments(silence, await this.getAudioDuration(inputPath));
  }

  // Métodos auxiliares internos
  parseSilenceDetection(logContent) {
    const silenceRegex = /silence_start: (\d+\.\d+).*?silence_end: (\d+\.\d+)/gs;
    const matches = [...logContent.matchAll(silenceRegex)];
    
    return matches.map(match => {
      const start = parseFloat(match[1]);
      const end = parseFloat(match[2]);
      return {
        start,
        end,
        duration: end - start
      };
    });
  }

  invertSilenceSegments(silenceSegments, totalDuration) {
    const speechSegments = [];
    let lastEnd = 0;

    silenceSegments.forEach(segment => {
      if (segment.start > lastEnd) {
        speechSegments.push({
          start: lastEnd,
          end: segment.start,
          duration: segment.start - lastEnd
        });
      }
      lastEnd = segment.end;
    });

    if (lastEnd < totalDuration) {
      speechSegments.push({
        start: lastEnd,
        end: totalDuration,
        duration: totalDuration - lastEnd
      });
    }

    return speechSegments;
  }
}

// Utilitário para análise pontual
export async function quickAnalyze(inputPath) {
  const analyzer = new AudioAnalyzer();
  return analyzer.autoDetectAudioIssues(inputPath);
}
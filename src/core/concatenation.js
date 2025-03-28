// src/core/concatenation.js
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { config } from '../config/config.js';
import { Progress } from '../utils/progressBar.js';
import { FileUtils } from '../utils/fileUtils.js';
import { transitionEngine } from './videoTransactions.js';

export class Concatenator {
  constructor() {
    this.inputFiles = [];
    this.transitionDuration = config.visualEffects.transitionDuration;
  }

  /**
   * Concatena vídeos com transições
   * @param {Array<string>} clips - Lista de caminhos dos vídeos
   * @returns {Promise<string>} Caminho do vídeo final
   */
  async concatenateClips(clips) {
    const tempFile = await this.createConcatListFile(clips);
    const outputPath = FileUtils.generateOutputFilename('final_edit.mp4');
    
    try {
      return await this.processConcatenation(tempFile, outputPath, clips); // Adicionado clips como parâmetro
    } finally {
      if (config.processing.cleanup.tempFiles) {
        await FileUtils.safeDelete(tempFile);
      }
    }
  }

  /**
   * Cria arquivo temporário com lista de vídeos
   */
  async createConcatListFile(clips) {
    const durations = await Promise.all(clips.map(clip => this.getClipDuration(clip)));
    const concatContent = clips.map((clip, index) => 
      `file '${clip}'\nduration ${durations[index]}`
    ).join('\n');

    const tempFile = path.join(os.tmpdir(), `concat_${Date.now()}.txt`);
    await fs.writeFile(tempFile, concatContent);
    return tempFile;
  }

  /**
   * Processa a concatenação com FFmpeg
   */
  async processConcatenation(inputList, outputPath, clips) { // Adicionado clips como parâmetro
    const command = ffmpeg()
      .input(inputList)
      .inputFormat('concat')
      .safeOptions()
      .outputOptions('-c copy')
      .output(outputPath);

    if (config.visualEffects.transitionsEnabled) {
      this.applyComplexTransitions(command, clips);
    }

    return this.executeCommand(command, outputPath);
  }

  /**
   * Aplica transições complexas entre clipes
   */
  applyComplexTransitions(command, clips) {
    transitionEngine.applyTransitions(command, clips);
    command.outputOptions('-vsync 2');
  }

  /**
   * Executa o comando com tratamento de erros
   */
  async executeCommand(command, outputPath) {
    const taskId = Progress.start({
      type: 'concat',
      context: 'Concatenando vídeos'
    });

    try {
      await new Promise((resolve, reject) => {
        command
          .on('progress', Progress.ffmpegHandler(taskId))
          .on('end', () => {
            Progress.complete(taskId);
            resolve();
          })
          .on('error', reject)
          .run();
      });
      return outputPath;
    } catch (error) {
      Progress.log(`Falha na concatenação: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Obtém duração do clipe usando FFprobe
   */
  async getClipDuration(clipPath) {
    const metadata = await FileUtils.getVideoMetadata(clipPath);
    return Math.max(metadata.format.duration - this.transitionDuration, 0);
  }

  /**
   * Processamento em lote com concorrência
   */
  async batchConcatenate(clipsGroups) {
    const pool = [];
    
    for (const group of clipsGroups) {
      while (pool.length >= config.processing.concurrency.clip) {
        await Promise.race(pool);
      }
      
      const task = this.concatenateClips(group)
        .finally(() => pool.splice(pool.indexOf(task), 1));
      
      pool.push(task);
    }
    
    return Promise.all(pool);
  }
}

// Singleton para uso geral
export const concatenator = new Concatenator();
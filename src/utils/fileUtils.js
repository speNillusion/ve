import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fsExtra from 'fs-extra';
import crypto from 'crypto';
import { config } from '../config/config.js';
import { Progress } from './progressBar.js';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import checkDiskSpace from 'check-disk-space';

const ffprobe = promisify(ffmpeg.ffprobe);

// Configurações derivadas
let TEMP_DIR;

export class FileUtils {
  constructor() {
    this.initialized = false;
  }

   /**
   * Verifica espaço em disco disponível (versão cross-platform)
   */
   async checkDiskSpace(requiredBytes) {
    try {
      const { free } = await checkDiskSpace(config.output.directory);
      return free >= requiredBytes;
    } catch (error) {
      Progress.log(`Erro ao verificar espaço: ${error.message}`, 'error');
      return false;
    }
  }



  /**
   * Inicializa o diretório temporário
   */
  async initialize() {
    if (!this.initialized) {
      TEMP_DIR = path.join(
        os.tmpdir(),
        `${config.processing.tempDirPrefix}${crypto.randomBytes(4).toString('hex')}`
      );
      await fsExtra.ensureDir(TEMP_DIR);
      this.initialized = true;
    }
    return TEMP_DIR;
  }

  /**
   * Limpeza de arquivos temporários
   */
  static async cleanupTempFiles() {
    if (config.processing.cleanup.tempFiles && TEMP_DIR) {
      try {
        await fsExtra.remove(TEMP_DIR);
        Progress.log('Arquivos temporários removidos com sucesso', 'info');
        return true;
      } catch (error) {
        Progress.log(`Falha na limpeza: ${error.message}`, 'warn');
        return false;
      }
    }
    return false;
  }

  /**
   * Valida arquivos de entrada conforme configurações
   */
  async validateInputFiles() {
    const validationResults = { valid: [], invalid: [] };
    const files = await this.scanInputDirectory();

    await Promise.all(
      files.map(async (filePath) => {
        try {
          await this.validateVideoFile(filePath);
          validationResults.valid.push(filePath);
        } catch (error) {
          validationResults.invalid.push({
            path: filePath,
            error: error.message,
          });
        }
      })
    );

    return validationResults;
  }

  /**
   * Valida um arquivo de vídeo individual
   */
  async validateVideoFile(filePath) {
    const checks = {
      extension: () => this.checkFileExtension(filePath),
      exists: () => this.fileExists(filePath),
      size: () => this.checkFileSize(filePath),
      duration: () => this.checkVideoDuration(filePath),
      integrity: () => this.checkFileIntegrity(filePath),
    };

    for (const [checkName, checkFn] of Object.entries(checks)) {
      try {
        await checkFn();
      } catch (error) {
        throw new Error(`Falha na validação ${checkName}: ${error.message}`);
      }
    }

    return true;
  }

  /**
   * Verifica a duração do vídeo usando FFprobe
   */
  async checkVideoDuration(filePath) {
    const metadata = await this.getVideoMetadata(filePath);
    if (metadata.format.duration < 0.5) {
      throw new Error('Arquivo muito curto (menos de 0.5 segundos)');
    }
    return true;
  }

  /**
   * Obtém metadados completos do vídeo
   */
  async getVideoMetadata(filePath) {
    try {
      return await ffprobe(filePath);
    } catch (error) {
      throw new Error(`Erro ao ler metadados: ${error.message}`);
    }
  }

  /**
   * Verifica a extensão do arquivo
   */
  async checkFileExtension(filePath) {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    if (!config.input.extensions.includes(ext)) {
      throw new Error(`Extensão não permitida: ${ext}`);
    }
    return true;
  }

  /**
   * Verifica existência do arquivo
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      throw new Error('Arquivo não encontrado ou sem permissão de leitura');
    }
  }

  /**
   * Verifica tamanho mínimo do arquivo
   */
  async checkFileSize(filePath) {
    const stats = await fs.stat(filePath);
    if (stats.size < 1024 * 100) {
      // 100KB
      throw new Error('Arquivo muito pequeno (possível corrupção)');
    }
    return true;
  }

  /**
   * Verifica integridade do arquivo via checksum
   */
  async checkFileIntegrity(filePath) {
    const hash = await this.generateFileHash(filePath);
    if (!hash) throw new Error('Falha ao gerar checksum');
    return true;
  }

  /**
   * Varre o diretório de entrada por arquivos válidos
   */
  async scanInputDirectory() {
    try {
      const files = await fs.readdir(config.input.directory);
      return files
        .filter((file) =>
          config.input.extensions.includes(path.extname(file).toLowerCase().slice(1))
        )
        .map((file) => path.join(config.input.directory, file));
    } catch (error) {
      Progress.log(`Erro ao ler diretório de entrada: ${error.message}`, 'error');
      return [];
    }
  }

  /**
   * Gera hash MD5 do arquivo
   */
  async generateFileHash(filePath, algorithm = 'md5') {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Operação de arquivo com retry
   */
  async withFileRetry(operation, filePath, attempts = config.processing.retry.attempts) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation(filePath);
      } catch (error) {
        if (i === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, config.processing.retry.delay));
      }
    }
  }

  /**
   * Gera nome seguro para arquivo de saída
   */
  generateOutputFilename(baseName, platform) {
    const safeName = baseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const ext = path.extname(config.output.filenames[platform]) || '.mov'; // Extrai extensão do config
    
    return path.join(
      config.output.directory,
      `${safeName}_${platform}_${Date.now()}${ext}`
    );
  }

  /**
   * Verifica espaço em disco disponível
   */
  async checkDiskSpace(requiredBytes) {
    try {
      const stats = await fs.statfs(config.output.directory);
      const freeSpace = stats.bsize * stats.bavail;
      return freeSpace >= requiredBytes;
    } catch (error) {
      Progress.log(`Erro ao verificar espaço: ${error.message}`, 'error');
      return false;
    }
  }
}

// Export singleton instance
export const fileUtils = new FileUtils();

// Bind static methods to the singleton instance
fileUtils.cleanupTempFiles = FileUtils.cleanupTempFiles.bind(FileUtils);

// Export individual functions for direct use
export const cleanupTempFiles = FileUtils.cleanupTempFiles;
export const validateInputFiles = (fileUtils) => fileUtils.validateInputFiles.bind(fileUtils);
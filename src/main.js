// main.js
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { config } from './config/config.js';
import { fileUtils } from './utils/fileUtils.js';
import { Progress } from './utils/progressBar.js';

const CPU_CORES = cpus().length;
const DEBUG = process.argv.includes('--verbose');

export class PipelineManager {
  constructor() {
    console.log('PipelineManager initialized.');
    this.workerPool = new Map();
    this.taskQueue = [];
    this.progressBar = null;
  }

  async process() {

    const heartbeat = setInterval(() => {
      Progress.update(pipelineProgressId, { context: 'Processando...' });
    }, 1500);

    let pipelineProgressId;
    try {
      if (DEBUG) console.log('[DEBUG] Iniciando pipeline...');
      pipelineProgressId = Progress.start({ 
        type: 'pipeline',
        total: 100,
        context: 'Processamento Geral'
      });

      await fileUtils.initialize();
      Progress.update(pipelineProgressId, { value: 10 });

      // Etapa 1: Validação
      const inputs = await this.parallelValidation();
      Progress.update(pipelineProgressId, { value: 30 });
      
      if (!inputs || inputs.length === 0) {
        console.log('Nenhum arquivo válido encontrado. Encerrando.');
        return;
      }

      // Etapa 2: Processamento
      await this.createProcessingPipeline(inputs);
      Progress.update(pipelineProgressId, { value: 100 });

    } catch (err) {
      console.error('[ERRO]', err.stack);
    } finally {
      await fileUtils.cleanupTempFiles();
      if (pipelineProgressId) Progress.complete(pipelineProgressId);
      console.log('Temporary files cleaned up.');
    }
  }

  async parallelValidation() {
    const validationProgressId = Progress.start({
      type: 'validation',
      total: 100,
      context: 'Validando Arquivos'
    });

    try {
      const files = await fileUtils.scanInputDirectory();
      if (DEBUG) console.log('[DEBUG] Files found:', files);

      if (files.length === 0) return [];

      const workers = [];
      const chunkSize = Math.ceil(files.length / CPU_CORES);

      // Atualizar progresso a cada worker concluído
      const progressIncrement = 100 / files.length;
      
      for (let i = 0; i < CPU_CORES; i++) {
        const worker = new Worker('./src/core/validationWorker.js', {
          workerData: {
            files: files.slice(i * chunkSize, (i + 1) * chunkSize),
            config: config,
          },
        });

        workers.push(
          new Promise((resolve, reject) => {
            worker.on('message', (result) => {
              if (result.progress) {
                Progress.update(validationProgressId, { 
                  increment: result.progress,
                  context: `Processados ${processedFiles++}/${totalFiles} arquivos`
                });
              }
            });
            worker.on('error', reject);
            worker.on('exit', (code) => {
              if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
            });
          })
        );
      }

      const results = await Promise.all(workers);
      Progress.complete(validationProgressId);
      return results.flatMap(r => r.valid);

    } catch (error) {
      Progress.log(`Falha na validação: ${error.message}`, 'error');
      throw error;
    }
  }

  async createProcessingPipeline(validFiles) {
    const stages = [
      { name: 'Processing', weight: 25 },
      { name: 'Concatenation', weight: 20 },
      { name: 'Cropping', weight: 15 },
      { name: 'Transitions', weight: 20 },
      { name: 'Exportation', weight: 20 }, // Nome corrigido
    ];

    const pipelineProgressId = Progress.start({
      type: 'pipeline',
      total: stages.reduce((sum, stage) => sum + stage.weight, 0),
      context: 'Processamento de Vídeo'
    });

    try {
      let currentFiles = validFiles;
      for (const stage of stages) {
        await this.executeStage(currentFiles, stage);
        Progress.update(pipelineProgressId, { increment: stage.weight });
        currentFiles = await this.getNextStageFiles(stage.name);
      }
    } finally {
      clearInterval(heartbeat);
      Progress.complete(pipelineProgressId);
    }
  }

  async executeStage(files, stage) {
    const stageProgressId = Progress.start({
      type: stage.name.toLowerCase(),
      total: files.length,
      context: `Processando ${stage.name}`
    });

    try {
      const chunkSize = Math.max(1, Math.ceil(files.length / CPU_CORES));
      const tasks = [];

      for (let i = 0; i < CPU_CORES; i++) {
        const chunk = files.slice(i * chunkSize, (i + 1) * chunkSize);
        if (chunk.length === 0) continue;

        const task = this.createWorkerTask(stage.name, chunk, stageProgressId);
        tasks.push(task);
      }

      await Promise.all(tasks);
    } finally {
      Progress.complete(stageProgressId);
    }
  }

  createWorkerTask(stage, files, progressId) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(`./src/core/${stage}Worker.js`, {
        workerData: { files, config },
      });

      worker.on('message', (msg) => {
        if (msg.progress) {
          Progress.update(progressId, { increment: msg.progress });
        }
        resolve(msg);
      });

      worker.on('error', (err) => {
        Progress.log(`Erro no worker ${stage}: ${err.message}`, 'error');
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker ${stage} exited with code ${code}`));
      });
    });
  }

  async getNextStageFiles(stageName) {
    // Implementação fictícia - ajustar conforme sua lógica real
    return [`processed_${stageName.toLowerCase()}.mov`];
  }
}

new PipelineManager()
  .process()
  .then(() => console.log('Processamento concluído com sucesso!'))
  .catch((err) => console.error('Erro no pipeline:', err));
  
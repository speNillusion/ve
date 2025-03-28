// src/utils/progressBar.js
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { config } from '../config/config.js';
import { performance } from 'perf_hooks';

// Cores personalizadas (UTF-8 seguro)
const progressColors = {
  youtube: '#FF0000',
  tiktok: '#00FFFF',
  audio: '#00FF00',
  pipeline: '#FFA500',
  default: '#FFFFFF'
};



export class ProgressBar {
  constructor() {
    this.multibar = new cliProgress.MultiBar({
      clearOnComplete: true,
      hideCursor: true,
      format: (options, params, payload) => {
        const color = chalk.hex(payload.color || progressColors.default);
        const progress = Math.floor(params.progress * 100);
        
        return [
          color(`${payload.taskType} ${chalk.bold(payload.id)}]`),
          color(`[${this._getProgressBar(params.progress)}]`),
          color(`${progress}%`),
          chalk.gray(`ETA: ${this._formatTime(params.eta)}`),
          payload.context && chalk.cyan(payload.context)
        ].filter(Boolean).join('  ');
      },
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      barsize: 25,
      forceRedraw: true,
      fps: 15,
      sync: false,
      stopOnComplete: true,
      etaBuffer: 50,
      noTTYOutput: false,
      notTTYSchedule: 1000
    }, cliProgress.Presets.shades_grey);

    this._formatTime = this._formatTime.bind(this);
    this._getProgressBar = this._getProgressBar.bind(this);

    this.tasks = new Map();
    this.lastRender = 0;
  }

    // Adicione este método na classe ProgressBar:
  _getTaskTypeIcon(type) {
    const icons = {
      pipeline: '⏳',
      validation: '🔍',
      processing: '🎬',
      concatenation: '🔗',
      cropping: '✂️',
      transitions: '🌅',
      export: '📤',
      generic: '🔄'
    };
    return icons[type] || icons.generic;
  }

  _getProgressBar(progress) {
    const width = 20;
    const filled = Math.round(progress * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  _logCompletion(task) {
    if (!config.logging.enabled) return;
    
    const duration = ((performance.now() - task.startTime) / 1000).toFixed(2);
    console.log(
      chalk.green('✓'),
      chalk.bold(`${task.type.toUpperCase()} concluído em`),
      chalk.cyan(`${duration}s`)
    );
  }

  _formatTime(seconds) {
    if (isNaN(seconds)) return '--:--';
    
    // Corrigindo cálculo do tempo
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return [hours, minutes, secs]
      .map(v => v.toString().padStart(2, "0"))
      .join(":")
      .replace(/^00:/, ""); // Remove horas se zero
  }

  startTask(options = {}) {
    const taskId = `task_${performance.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const settings = {
      id: taskId,
      type: 'generic',
      total: 100,
      startValue: 0,
      context: '',
      color: progressColors.default,
      ...options
    };

    const bar = this.multibar.create(settings.total, settings.startValue, {
      taskType: this._getTaskTypeIcon(settings.type),
      id: settings.id,
      context: settings.context,
      color: settings.color
    });

    this.tasks.set(taskId, {
      bar,
      startTime: performance.now(),
      lastUpdate: 0,
      type: settings.type
    });

    return taskId;
  }

  update(taskId, data = {}) {
    if (!this.tasks.has(taskId)) return;

    const task = this.tasks.get(taskId);
    const now = performance.now();

    // Limite de 15 FPS
    if (now - task.lastUpdate < 66) return;

    if (data.value !== undefined) task.bar.update(data.value);
    if (data.total !== undefined) task.bar.setTotal(data.total);
    if (data.context !== undefined) task.bar.update({ context: data.context });

    task.lastUpdate = now;
    this.multibar.update();
  }

  complete(taskId) {
    if (!this.tasks.has(taskId)) return;

    const task = this.tasks.get(taskId);
    task.bar.update(100);
    this.multibar.remove(task.bar);
    this.tasks.delete(taskId);
    this._logCompletion(task);
  }

  // ... (métodos privados mantêm a implementação anterior corrigida)
}

export const progressBar = new ProgressBar();
export const Progress = {
  start: (options) => progressBar.startTask(options),
  update: (taskId, data) => progressBar.update(taskId, data),
  complete: (taskId) => progressBar.complete(taskId),
  log: (message, level) => console.log(message)
};
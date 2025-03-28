// src/utils/resourceMonitor.js
import os from 'os';
import { config } from '../config/config.js';
import { Progress } from './progressBar.js';
import { EventEmitter } from 'events';
import { fileUtils } from './fileUtils.js';

export class ResourceMonitor extends EventEmitter {
  constructor() {
    super();
    this.interval = null;
    this.stats = {
      cpu: {
        current: 0,
        average: 0,
        history: []
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      disk: {
        free: 0,
        total: 0,
        used: 0
      }
    };
  }

  start(configInterval) {
    if (!this.interval) {
      this.interval = setInterval(() => this.updateStats(), configInterval);
      this.updateStats();
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async updateStats() {
    try {
      // Coleta de dados de CPU
      const cpuLoad = await this.getCpuLoad();
      this.updateCpuStats(cpuLoad);
      
      // Atualiza memória
      this.stats.memory.free = os.freemem();
      this.stats.memory.used = this.stats.memory.total - this.stats.memory.free;
      
      // Atualiza disco
      const diskStats = await fileUtils.checkDiskSpace(0);
      this.stats.disk = {
        free: diskStats.free,
        total: diskStats.total,
        used: diskStats.total - diskStats.free
      };

      // Emite alertas se necessário
      this.checkThresholds();
      
    } catch (error) {
      Progress.log(`Erro no monitoramento: ${error.message}`, 'error');
    }
  }

  updateCpuStats(currentLoad) {
    this.stats.cpu.current = currentLoad;
    this.stats.cpu.history.push(currentLoad);
    
    // Mantém histórico das últimas 10 medições
    if (this.stats.cpu.history.length > 10) {
      this.stats.cpu.history.shift();
    }
    
    // Calcula média móvel
    this.stats.cpu.average = this.stats.cpu.history.reduce((a, b) => a + b, 0) / 
                             this.stats.cpu.history.length;
  }

  async getCpuLoad() {
    const startTime = process.hrtime();
    const startUsage = process.cpuUsage();
    
    return new Promise((resolve) => {
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const elapsedTime = process.hrtime(startTime);
        const elapsedMicros = (elapsedTime[0] * 1e9 + elapsedTime[1]) / 1e3;
        
        const cpuPercent = ((endUsage.user + endUsage.system) / elapsedMicros) * 100;
        resolve(cpuPercent);
      }, 1000);
    });
  }


  async checkThresholds() {
    const thresholds = {
      cpu: config.processing.resourceThresholds?.cpu || 85,
      memory: config.processing.resourceThresholds?.memory || 90,
      disk: config.processing.resourceThresholds?.disk || 90
    };

    // Verifica CPU
    if (this.stats.cpu.average > thresholds.cpu) {
      this.emit('warning', {
        type: 'cpu',
        value: this.stats.cpu.average,
        threshold: thresholds.cpu
      });
    }

    // Verifica Memória
    const memoryUsage = (this.stats.memory.used / this.stats.memory.total) * 100;
    if (memoryUsage > thresholds.memory) {
      this.emit('warning', {
        type: 'memory',
        value: memoryUsage,
        threshold: thresholds.memory
      });
    }

    // Verifica Disco
    const diskUsage = (this.stats.disk.used / this.stats.disk.total) * 100;
    if (diskUsage > thresholds.disk) {
      this.emit('warning', {
        type: 'disk',
        value: diskUsage,
        threshold: thresholds.disk
      });
    }
  }

  getCurrentStatus() {
    return {
      cpu: {
        ...this.stats.cpu,
        cores: os.cpus().length
      },
      memory: {
        ...this.stats.memory,
        usage: (this.stats.memory.used / this.stats.memory.total) * 100
      },
      disk: {
        ...this.stats.disk,
        usage: (this.stats.disk.used / this.stats.disk.total) * 100
      }
    };
  }

  async isSystemUnderLoad() {
    const status = this.getCurrentStatus();
    return {
      cpu: status.cpu.average > 70,
      memory: status.memory.usage > 80,
      disk: status.disk.usage > 90
    };
  }
}

resourceMonitor.on('warning', (data) => {
  if (data.type === 'disk' && data.value > 95) {
    require('./platformExport.js').platformExporter.abortAllExports();
  }
});

// Singleton para uso global
export const resourceMonitor = new ResourceMonitor();

// Inicialização automática com configurações do sistema
resourceMonitor.start(config.processing.monitorInterval || 5000);


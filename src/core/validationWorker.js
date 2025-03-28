import { parentPort } from 'worker_threads';
import { FileUtils } from '../utils/fileUtils.js';

// Instancia o FileUtils dentro do worker
const fileUtils = new FileUtils();

parentPort.on('message', async ({ files, config }) => {
  const localFileUtils = new FileUtils();
  try {
    await localFileUtils.initialize();
    
    const totalFiles = files.length;
    let processed = 0;

    for (const filePath of files) {
      try {
        await localFileUtils.validateVideoFile(filePath);
        parentPort.postMessage({ 
          progress: 100 / totalFiles,
          valid: [filePath] 
        });
      } catch (error) {
        parentPort.postMessage({ 
          progress: 100 / totalFiles,
          invalid: { path: filePath, error: error.message }
        });
      }
      processed++;
    }

  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
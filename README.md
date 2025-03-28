# Video Export (VE)

Um processador de vídeo profissional que utiliza FFmpeg para converter e otimizar vídeos para diferentes plataformas, com suporte especial para ProRes.

## Características Principais

- **Processamento ProRes**: Conversão de alta qualidade para formato ProRes com configurações otimizadas
- **Exportação Multi-plataforma**: Suporte para exportação simultânea para YouTube e TikTok
- **Processamento de Áudio**: Normalização de áudio e controle de qualidade
- **Efeitos Visuais**: Suporte para transições e efeitos de zoom
- **Gerenciamento de Recursos**: Monitoramento de recursos do sistema e retry automático

## Arquitetura

### Core
- **clipProcessing.js**: Processamento individual de clipes
- **platformExport.js**: Exportação específica para cada plataforma
- **audioAnalysis.js**: Análise e processamento de áudio
- **concatenation.js**: Junção de múltiplos clipes
- **videoTransactions.js**: Gerenciamento de transações de vídeo

### Utils
- **ffmpegUtils.js**: Utilitários e configurações do FFmpeg
- **fileUtils.js**: Gerenciamento de arquivos
- **progressBar.js**: Interface de progresso
- **resourceMonitor.js**: Monitoramento de recursos

## Configurações FFmpeg

### Configurações Base
- Qualidade de áudio otimizada (audioQuality: 0)
- 2 canais de áudio
- Threads: 4
- Preset: medium
- Probesize e analyzeduration: 50M

### Configurações ProRes
- Codec: prores
- Formato de pixel: yuv422p10le
- Codec de áudio: pcm_s24le
- Flags de cor: bt709
- Movflags: write_colr

## Recursos Avançados

### Processamento Paralelo
- Suporte para processamento simultâneo de múltiplos vídeos
- Exportação paralela para diferentes plataformas

### Sistema de Retry
- Tentativas automáticas em caso de falha
- Delay configurável entre tentativas
- Monitoramento de recursos do sistema

### Efeitos e Transições
- Zoom dinâmico configurável
- Transições entre clipes (slide left)
- Crossfade de áudio

### Processamento de Áudio
- Normalização de áudio (loudnorm)
- Configuração de nível alvo
- Controle de LRA

## Uso

```javascript
// Exemplo de uso básico
const { ffmpegProcessor } = require('./src/utils/ffmpegUtils');

// Processamento para uma plataforma específica
await ffmpegProcessor.processForPlatform(inputPath, 'youtube');

// Processamento paralelo para múltiplas plataformas
await ffmpegProcessor.parallelProcessing(inputPath);
```

## Requisitos

- FFmpeg instalado com suporte a ProRes
- Node.js
- Espaço em disco suficiente para processamento de vídeo em alta qualidade

## Configuração

As configurações do sistema podem ser ajustadas através do arquivo `config.js`, incluindo:
- Formatos de saída por plataforma
- Configurações de retry
- Parâmetros de efeitos visuais
- Configurações de áudio
- Diretórios de trabalho

## Mudanças feitas

Analisando o código, o erro de congelamento estava ocorrendo devido a alguns fatores: 
1. O sistema estava sobrecarregado durante o processamento dos vídeos, sem um controle adequado de recursos 
2. O processamento paralelo estava consumindo muita memória e CPU sem limites apropriados 
3. Não havia um mecanismo eficiente de timeout para detectar e interromper processos travados 
4. O sistema de retry não estava verificando adequadamente os recursos disponíveis antes de tentar novamente 
5. O gerenciamento de processos ativos não estava sendo feito de forma eficiente.
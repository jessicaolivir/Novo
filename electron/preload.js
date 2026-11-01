// Ponte segura entre a interface (página) e o processo principal do programa.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdvDesktop', {
  gmailStatus: () => ipcRenderer.invoke('gmail:status'),
  gmailSalvar: dados => ipcRenderer.invoke('gmail:salvar', dados),
  gmailRemover: () => ipcRenderer.invoke('gmail:remover'),
  gmailEnviar: dados => ipcRenderer.invoke('gmail:enviar', dados),
  salvarBackupLocal: dados => ipcRenderer.invoke('backup:salvarLocal', dados),
  abrirPastaBackups: () => ipcRenderer.invoke('backup:abrirPasta'),
  abrirLink: url => ipcRenderer.invoke('abrirLink', url)
});

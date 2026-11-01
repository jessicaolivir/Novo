// Processo principal do programa PDV (Electron).
// Cria a janela, guarda a senha de app do Gmail de forma criptografada
// e envia os backups por e-mail pelo servidor SMTP do Gmail.
const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const RAIZ = path.join(__dirname, '..');
const MANTER_BACKUPS = 60;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f6fb',
    title: 'PDV',
    icon: path.join(RAIZ, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  janela.loadFile(path.join(RAIZ, 'index.html'));
  janela.once('ready-to-show', () => { janela.maximize(); janela.show(); });

  // Links externos abrem no navegador padrão; a janela nunca sai do PDV.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  // F11 alterna tela cheia; Ctrl + e Ctrl - ajustam o zoom.
  janela.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = janela.webContents;
    if (input.key === 'F11') { janela.setFullScreen(!janela.isFullScreen()); e.preventDefault(); }
    else if (input.control && (input.key === '=' || input.key === '+')) { wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4)); e.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); e.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); e.preventDefault(); }
  });

  janela.on('closed', () => { janela = null; });
}

app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

app.whenReady().then(criarJanela);
app.on('window-all-closed', () => app.quit());

// ---------- Credenciais do Gmail ----------
const arquivoCredenciais = () => path.join(app.getPath('userData'), 'gmail.json');

function lerCredenciais() {
  try {
    const c = JSON.parse(fs.readFileSync(arquivoCredenciais(), 'utf8'));
    const buf = Buffer.from(c.senha, 'base64');
    const senha = c.cifrado ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return { email: c.email, destino: c.destino || '', senha, cifrado: !!c.cifrado };
  } catch {
    return null;
  }
}

function gravarCredenciais({ email, destino, senha }) {
  const cifrado = safeStorage.isEncryptionAvailable();
  const buf = cifrado ? safeStorage.encryptString(senha) : Buffer.from(senha, 'utf8');
  fs.mkdirSync(path.dirname(arquivoCredenciais()), { recursive: true });
  fs.writeFileSync(arquivoCredenciais(), JSON.stringify({ email, destino, senha: buf.toString('base64'), cifrado }), { mode: 0o600 });
}

function transporte(email, senha) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: email, pass: senha },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 60000
  });
}

function traduzirErro(err) {
  const code = err && (err.code || '');
  const resp = String((err && err.response) || (err && err.message) || '');
  if (code === 'EAUTH' || /535|534|Username and Password not accepted|Application-specific password required/i.test(resp)) {
    return 'O Gmail recusou o acesso. Confira o endereço e a senha de app de 16 letras (não use a senha normal da conta).';
  }
  if (['EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNECTION', 'ETIMEDOUT', 'ECONNREFUSED', 'ESOCKET', 'ECONNRESET'].includes(code) ||
      /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|getaddrinfo|timeout/i.test(resp)) {
    return 'Sem conexão com a internet ou com o Gmail. O backup será tentado novamente mais tarde.';
  }
  if (/552|size/i.test(resp)) return 'O arquivo de backup ficou grande demais para o Gmail.';
  return 'Não foi possível enviar o e-mail: ' + (err && err.message ? err.message : 'erro desconhecido') + '.';
}

const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

ipcMain.handle('gmail:status', () => {
  const c = lerCredenciais();
  return c
    ? { configurado: true, email: c.email, destino: c.destino, cifrado: c.cifrado }
    : { configurado: false, email: '', destino: '' };
});

ipcMain.handle('gmail:salvar', async (_e, dados) => {
  const email = String(dados.email || '').trim().toLowerCase();
  const destino = String(dados.destino || '').trim().toLowerCase();
  let senha = String(dados.senha || '').replace(/\s+/g, '');
  if (!emailValido(email)) return { ok: false, erro: 'Informe um endereço de Gmail válido.' };
  if (destino && !emailValido(destino)) return { ok: false, erro: 'O e-mail de destino é inválido.' };
  if (!senha) {
    const atual = lerCredenciais();
    if (!atual) return { ok: false, erro: 'Informe a senha de app do Google.' };
    senha = atual.senha;
  }
  try {
    await transporte(email, senha).verify();
  } catch (err) {
    return { ok: false, erro: traduzirErro(err) };
  }
  gravarCredenciais({ email, destino, senha });
  return { ok: true };
});

ipcMain.handle('gmail:remover', () => {
  try { fs.unlinkSync(arquivoCredenciais()); } catch { /* já não existia */ }
  return { ok: true };
});

ipcMain.handle('gmail:enviar', async (_e, dados) => {
  const c = lerCredenciais();
  if (!c) return { ok: false, erro: 'O Gmail não está configurado.' };
  try {
    await transporte(c.email, c.senha).sendMail({
      from: `PDV <${c.email}>`,
      to: c.destino || c.email,
      subject: String(dados.assunto || 'Backup PDV'),
      text: String(dados.texto || ''),
      attachments: [{
        filename: path.basename(String(dados.nomeArquivo || 'backup-pdv.json')),
        content: String(dados.conteudo || ''),
        contentType: 'application/json'
      }]
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: traduzirErro(err) };
  }
});

// ---------- Backup em arquivo ----------
const pastaBackups = () => path.join(app.getPath('documents'), 'PDV Backups');

ipcMain.handle('backup:salvarLocal', (_e, dados) => {
  try {
    const pasta = pastaBackups();
    fs.mkdirSync(pasta, { recursive: true });
    const nome = path.basename(String(dados.nomeArquivo || 'backup-pdv.json'));
    const caminho = path.join(pasta, nome);
    fs.writeFileSync(caminho, String(dados.conteudo || ''), 'utf8');

    // Mantém apenas os backups mais recentes.
    const antigos = fs.readdirSync(pasta)
      .filter(f => /^backup-pdv-.*\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(pasta, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(MANTER_BACKUPS);
    antigos.forEach(({ f }) => fs.unlinkSync(path.join(pasta, f)));
    return { ok: true, caminho, pasta };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
});

ipcMain.handle('backup:abrirPasta', async () => {
  fs.mkdirSync(pastaBackups(), { recursive: true });
  await shell.openPath(pastaBackups());
  return { ok: true };
});

ipcMain.handle('abrirLink', (_e, url) => {
  if (/^https:\/\//.test(String(url))) shell.openExternal(String(url));
  return { ok: true };
});

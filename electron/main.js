const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let backendProcess

function startBackend() {
  const serverPath = path.join(__dirname, '..', 'backend', 'server.js')
  backendProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: process.env.PORT || '3000' },
    stdio: 'inherit'
  })
}

function createWindow() {
  const win = new BrowserWindow({ width: 1300, height: 850 })
  if (process.env.NODE_ENV === 'production') {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    win.loadURL('http://localhost:5173')
  }
}

app.whenReady().then(() => {
  startBackend()
  createWindow()
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

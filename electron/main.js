const { app, BrowserWindow } = require('electron')
function createWindow(){ const win=new BrowserWindow({width:1400,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true}}); win.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:5173') }
app.whenReady().then(createWindow)
app.on('window-all-closed',()=>{ if(process.platform!=='darwin') app.quit() })

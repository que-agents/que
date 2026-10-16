import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import App from './App'
import { installTestHook } from './testHook'

installTestHook()

const root = document.getElementById('root')

if (!root) throw new Error('que: #root element missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
